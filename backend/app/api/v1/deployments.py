import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, require
from app.core.rbac import Permission
from app.db.session import get_db
from app.models import JobResult, PosDevice, User, XmlJob
from app.schemas.common import Page
from app.schemas.job import (DeploymentCreate, JobDetail, JobOut, JobResultDetail, JobResultOut, PosRef,
                             UploadBatchOut, UploadedFileOut)
from app.services import deployment_service as ds
from app.worker.celery_app import celery_app

router = APIRouter(prefix="/deployments", tags=["deployments"])


def _err(e: ds.DeploymentError):
    raise HTTPException(e.status_code, str(e))


def _enqueue(db: Session, job: XmlJob, result_ids: list[int] | None = None) -> None:
    res = celery_app.send_task("app.worker.tasks.run_deployment", args=[job.id, result_ids], queue="deployments")
    job.celery_task_id = res.id
    db.commit()


def _job_out(db: Session, job: XmlJob, detail: bool = False):
    counts = dict(db.execute(select(JobResult.status, func.count()).where(JobResult.job_id == job.id)
                             .group_by(JobResult.status)).all())
    data = JobOut.model_validate(job).model_dump()
    data.update(running_devices=counts.get("running", 0), pending_devices=counts.get("pending", 0),
                uploaded_by_username=job.user.username if job.user else None)
    if detail:
        data["results"] = [JobResultOut.model_validate(r) for r in sorted(job.results, key=lambda r: r.hostname)]
        return JobDetail(**data)
    return JobOut(**data)


@router.post("/uploads", response_model=UploadBatchOut)
async def upload(request: Request, files: list[UploadFile] = File(...), db: Session = Depends(get_db),
                 user: User = Depends(require(Permission.XML_UPLOAD))):
    try:
        batch_id, stored, rejected = await ds.handle_upload(db, user, files, client_ip(request))
    except ds.DeploymentError as e:
        _err(e)
    pos_ids = {s.matched_pos_id for s in stored if s.matched_pos_id}
    pos_map = {p.id: p for p in db.scalars(select(PosDevice).where(PosDevice.id.in_(pos_ids)))} if pos_ids else {}
    busy = ds.busy_pos_ids(db, pos_ids)
    out = []
    for s in stored:
        p = pos_map.get(s.matched_pos_id)
        out.append(UploadedFileOut(
            id=s.id, original_filename=s.original_filename, size_bytes=s.size_bytes, sha256=s.sha256,
            root_element=s.root_element, is_valid=s.is_valid, validation_error=s.validation_error,
            match_method=s.match_method, busy=bool(p and p.id in busy),
            matched_pos=PosRef(id=p.id, hostname=p.hostname, ip_address=str(p.ip_address).split("/")[0],
                               store_name=p.store_name) if p else None,
        ))
    # rejected files are reported as invalid pseudo-rows (negative id) so the UI can display them
    for i, (name, msg) in enumerate(rejected, start=1):
        out.append(UploadedFileOut(id=-i, original_filename=name,
                                   size_bytes=0, sha256="", root_element=None, is_valid=False,
                                   validation_error=msg, match_method=None, matched_pos=None))
    return UploadBatchOut(batch_id=batch_id, files=out)


@router.delete("/uploads/{batch_id}", status_code=204)
def discard(batch_id: uuid.UUID, db: Session = Depends(get_db), user: User = Depends(require(Permission.XML_UPLOAD))):
    try:
        ds.discard_batch(db, batch_id, user)
    except ds.DeploymentError as e:
        _err(e)


@router.post("", response_model=JobOut, status_code=201)
def start(body: DeploymentCreate, request: Request, db: Session = Depends(get_db),
          user: User = Depends(require(Permission.JOBS_RUN))):
    try:
        job = ds.create_job(db, user, body.batch_id, [(i.file_id, i.pos_id) for i in body.items], client_ip(request))
    except ds.DeploymentError as e:
        _err(e)
    _enqueue(db, job)
    return _job_out(db, job)


@router.get("/jobs", response_model=Page[JobOut])
def list_jobs(view: Literal["all", "running", "failed"] = "all", q: str | None = Query(None, max_length=100),
              page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200),
              db: Session = Depends(get_db), _: User = Depends(require(Permission.JOBS_READ))):
    stmt = select(XmlJob)
    if view == "running":
        stmt = stmt.where(XmlJob.status.in_(["pending", "running"]))
    elif view == "failed":
        stmt = stmt.where(XmlJob.status.in_(["failed", "partial"]))
    if q:
        if q.lstrip("#").isdigit():
            stmt = stmt.where(XmlJob.id == int(q.lstrip("#")))
        else:
            sub = select(JobResult.job_id).where(JobResult.hostname.ilike(f"%{q}%"))
            stmt = stmt.where((XmlJob.filename.ilike(f"%{q}%")) | XmlJob.id.in_(sub))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    jobs = db.scalars(stmt.order_by(XmlJob.id.desc()).offset((page - 1) * page_size).limit(page_size)).unique().all()
    return Page(items=[_job_out(db, j) for j in jobs], total=total, page=page, page_size=page_size)


def _job(db: Session, job_id: int) -> XmlJob:
    job = db.get(XmlJob, job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.get("/jobs/{job_id}", response_model=JobDetail)
def job_detail(job_id: int, db: Session = Depends(get_db), _: User = Depends(require(Permission.JOBS_READ))):
    return _job_out(db, _job(db, job_id), detail=True)


@router.get("/results/{result_id}", response_model=JobResultDetail)
def result_detail(result_id: int, db: Session = Depends(get_db), _: User = Depends(require(Permission.JOBS_READ))):
    r = db.get(JobResult, result_id)
    if not r:
        raise HTTPException(404, "Result not found")
    return r


@router.post("/jobs/{job_id}/retry", response_model=JobOut)
def retry_job(job_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(require(Permission.JOBS_RUN))):
    job = _job(db, job_id)
    try:
        ids = ds.prepare_retry(db, job, None, user, client_ip(request))
    except ds.DeploymentError as e:
        _err(e)
    _enqueue(db, job, ids)
    return _job_out(db, job)


@router.post("/results/{result_id}/retry", response_model=JobOut)
def retry_result(result_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(require(Permission.JOBS_RUN))):
    r = db.get(JobResult, result_id)
    if not r:
        raise HTTPException(404, "Result not found")
    job = r.job
    try:
        ids = ds.prepare_retry(db, job, [result_id], user, client_ip(request))
    except ds.DeploymentError as e:
        _err(e)
    _enqueue(db, job, ids)
    return _job_out(db, job)


@router.post("/jobs/{job_id}/cancel", response_model=JobOut)
def cancel(job_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(require(Permission.JOBS_RUN))):
    job = _job(db, job_id)
    try:
        ds.request_cancel(db, job, user, client_ip(request))
    except ds.DeploymentError as e:
        _err(e)
    return _job_out(db, job)
