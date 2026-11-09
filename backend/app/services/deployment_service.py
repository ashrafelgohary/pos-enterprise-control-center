"""Deployment orchestration: upload batches -> jobs -> worker execution -> results."""
from __future__ import annotations

import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis_client import get_redis
from app.models import JobResult, JobResultStatus, JobStatus, PosDevice, User, XmlFile, XmlJob
from app.services import audit_service as audit
from app.services import xml_service
from app.services.ansible_service import AnsibleConfigError, AnsibleService, DeploymentTarget
from app.services.pos_service import get_by_hostname

log = logging.getLogger(__name__)
ACTIVE_RESULT = (JobResultStatus.PENDING.value, JobResultStatus.RUNNING.value)


def now() -> datetime:
    return datetime.now(timezone.utc)


class DeploymentError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


# ----------------------------------------------------------------- uploads
def busy_pos_ids(db: Session, pos_ids: set[int]) -> set[int]:
    if not pos_ids:
        return set()
    rows = db.scalars(select(JobResult.pos_id).where(JobResult.pos_id.in_(pos_ids), JobResult.status.in_(ACTIVE_RESULT)))
    return set(rows)


async def handle_upload(db: Session, user: User, files: list[UploadFile], ip: str | None
                        ) -> tuple[uuid.UUID, list[XmlFile], list[tuple[str, str]]]:
    if not files:
        raise DeploymentError("No files received")
    if len(files) > settings.max_files_per_upload:
        raise DeploymentError(f"Too many files (max {settings.max_files_per_upload} per upload)")
    batch_id = uuid.uuid4()
    stored: list[XmlFile] = []
    rejected: list[tuple[str, str]] = []
    for f in files:
        try:
            info = await xml_service.store_and_validate(f, batch_id)
        except xml_service.UploadRejected as e:
            rejected.append((os.path.basename(f.filename or "unknown")[:255], str(e)))
            continue
        pos, method = None, None
        if info.is_valid:
            pos = get_by_hostname(db, xml_service.hostname_from_filename(info.original_filename))
            method = "filename" if pos else None
            if not pos:
                mac = xml_service.mac_from_filename(info.original_filename)
                if mac:
                    pos = db.scalar(select(PosDevice).where(cast(PosDevice.mac_address, String) == mac))
                    method = "mac" if pos else None
            if not pos and info.hostname_hint:
                pos = get_by_hostname(db, info.hostname_hint)
                method = "content" if pos else None
        rec = XmlFile(
            batch_id=batch_id, uploaded_by=user.id, original_filename=info.original_filename,
            stored_path=info.stored_path, size_bytes=info.size_bytes, sha256=info.sha256,
            root_element=info.root_element, is_valid=info.is_valid, validation_error=info.validation_error,
            matched_pos_id=pos.id if pos else None, match_method=method,
        )
        db.add(rec)
        stored.append(rec)
    db.flush()
    audit.record(db, audit.AuditAction.XML_UPLOADED, user=user, target=f"batch {batch_id}", ip=ip, details={
        "files": len(stored), "valid": sum(1 for s in stored if s.is_valid),
        "matched": sum(1 for s in stored if s.matched_pos_id), "rejected": [m for _, m in rejected][:50],
        "names": [s.original_filename for s in stored][:200],
    })
    db.commit()
    return batch_id, stored, rejected


def discard_batch(db: Session, batch_id: uuid.UUID, user: User) -> None:
    files = db.scalars(select(XmlFile).where(XmlFile.batch_id == batch_id)).all()
    if not files:
        raise DeploymentError("Upload batch not found", 404)
    used = db.scalar(select(func.count()).select_from(JobResult).where(JobResult.xml_file_id.in_([f.id for f in files])))
    if used:
        raise DeploymentError("Batch already used by a deployment and cannot be discarded", 409)
    for f in files:
        db.delete(f)
    shutil.rmtree(xml_service.batch_dir(batch_id), ignore_errors=True)
    db.commit()


# -------------------------------------------------------------------- jobs
def create_job(db: Session, user: User, batch_id: uuid.UUID, items: list[tuple[int, int]], ip: str | None) -> XmlJob:
    file_ids = {f for f, _ in items}
    pos_ids = {p for _, p in items}
    if len(pos_ids) != len(items):
        raise DeploymentError("Each POS can only receive one XML file per deployment")
    files = {f.id: f for f in db.scalars(select(XmlFile).where(XmlFile.id.in_(file_ids), XmlFile.batch_id == batch_id))}
    if len(files) != len(file_ids):
        raise DeploymentError("One or more files do not belong to this upload batch")
    if any(not f.is_valid for f in files.values()):
        raise DeploymentError("Invalid XML files cannot be deployed")
    pos_map = {p.id: p for p in db.scalars(select(PosDevice).where(PosDevice.id.in_(pos_ids)))}
    if len(pos_map) != len(pos_ids):
        raise DeploymentError("One or more target POS devices no longer exist")
    busy = busy_pos_ids(db, pos_ids)
    if busy:
        names = ", ".join(pos_map[i].hostname for i in busy)
        raise DeploymentError(f"Deployment already in progress for: {names}", 409)

    first = files[items[0][0]].original_filename
    job = XmlJob(
        uploaded_by=user.id, filename=first if len(items) == 1 else f"{first} (+{len(items) - 1})",
        file_count=len(file_ids), status=JobStatus.PENDING.value, total_devices=len(items),
    )
    db.add(job)
    db.flush()
    for file_id, pos_id in items:
        f, p = files[file_id], pos_map[pos_id]
        if f.matched_pos_id != p.id:
            f.matched_pos_id, f.match_method = p.id, "manual"
        db.add(JobResult(job_id=job.id, pos_id=p.id, xml_file_id=f.id, hostname=p.hostname,
                         ip_address=str(p.ip_address).split("/")[0], xml_filename=f.original_filename))
    audit.record(db, audit.AuditAction.DEPLOYMENT_STARTED, user=user, target=f"deployment #{job.id}", ip=ip,
                 details={"files": len(file_ids), "targets": [pos_map[p].hostname for _, p in items][:500]})
    db.commit()
    return job


def recompute(db: Session, job: XmlJob) -> None:
    db.flush()  # session uses autoflush=False; make pending status changes visible to the count query
    counts = dict(db.execute(select(JobResult.status, func.count()).where(JobResult.job_id == job.id).group_by(JobResult.status)).all())
    ok, bad = counts.get("success", 0), counts.get("failed", 0)
    cancelled = counts.get("cancelled", 0)
    active = counts.get("pending", 0) + counts.get("running", 0)
    job.total_devices = sum(counts.values())
    job.successful_devices, job.failed_devices = ok, bad
    if active:
        job.status = JobStatus.RUNNING.value if counts.get("running") or job.started_at else JobStatus.PENDING.value
        job.completed_at = None
    else:
        if ok == job.total_devices:
            job.status = JobStatus.SUCCESS.value
        elif cancelled and not ok and not bad:
            job.status = JobStatus.CANCELLED.value
        elif ok:
            job.status = JobStatus.PARTIAL.value
        else:
            job.status = JobStatus.FAILED.value
        job.completed_at = now()


def cancel_key(job_id: int) -> str:
    return f"job:{job_id}:cancel"


def request_cancel(db: Session, job: XmlJob, user: User, ip: str | None) -> None:
    if job.status not in (JobStatus.PENDING.value, JobStatus.RUNNING.value):
        raise DeploymentError("Job is not active", 409)
    get_redis().set(cancel_key(job.id), "1", ex=6 * 3600)
    # Pending results that never started are cancelled immediately
    for r in job.results:
        if r.status == JobResultStatus.PENDING.value:
            r.status, r.error_message, r.completed_at = JobResultStatus.CANCELLED.value, "Cancelled by user", now()
    recompute(db, job)
    audit.record(db, audit.AuditAction.DEPLOYMENT_CANCELLED, user=user, target=f"deployment #{job.id}", ip=ip)
    db.commit()


def prepare_retry(db: Session, job: XmlJob, result_ids: list[int] | None, user: User, ip: str | None) -> list[int]:
    retry = [r for r in job.results
             if r.status in (JobResultStatus.FAILED.value, JobResultStatus.CANCELLED.value)
             and (result_ids is None or r.id in result_ids)]
    if not retry:
        raise DeploymentError("Nothing to retry", 409)
    busy = busy_pos_ids(db, {r.pos_id for r in retry if r.pos_id})
    if busy:
        raise DeploymentError("Some target POS devices are busy with another deployment", 409)
    for r in retry:
        if r.pos_id is None:
            raise DeploymentError(f"POS {r.hostname} was deleted; cannot retry", 409)
        r.status, r.attempt = JobResultStatus.PENDING.value, r.attempt + 1
        r.error_message = r.started_at = r.completed_at = None
    get_redis().delete(cancel_key(job.id))
    recompute(db, job)
    audit.record(db, audit.AuditAction.DEPLOYMENT_RETRIED, user=user, target=f"deployment #{job.id}", ip=ip,
                 details={"hosts": [r.hostname for r in retry]})
    db.commit()
    return [r.id for r in retry]


# ------------------------------------------------------------ worker side
def _stage(target: DeploymentTarget) -> None:
    tpl = settings.ansible_stage_path_template
    if not tpl:
        return
    dest = Path(tpl.format(hostname=target.hostname, filename=target.xml_filename)).resolve()
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(target.xml_path, dest)
    target.xml_path = str(dest)


def execute(db_factory, job_id: int, result_ids: list[int] | None = None) -> None:
    """Runs inside the Celery worker. db_factory -> context-managed Session."""
    redis = get_redis()
    with db_factory() as db:
        job = db.get(XmlJob, job_id)
        if job is None:
            log.warning("job %s vanished", job_id)
            return
        q = select(JobResult).where(JobResult.job_id == job_id, JobResult.status == JobResultStatus.PENDING.value)
        if result_ids:
            q = q.where(JobResult.id.in_(result_ids))
        results = db.scalars(q).all()
        if not results:
            recompute(db, job)
            return
        targets: list[DeploymentTarget] = []
        for r in results:
            f = db.get(XmlFile, r.xml_file_id) if r.xml_file_id else None
            if f is None or not Path(f.stored_path).is_file():
                r.status, r.error_message, r.completed_at = "failed", "XML file missing on server", now()
                continue
            pos = r.pos
            t = DeploymentTarget(r.id, r.pos_id, r.hostname, r.ip_address, f.stored_path, f.original_filename,
                                 pos.store_name if pos else None, pos.brand if pos else None)
            try:
                _stage(t)
            except OSError as e:
                r.status, r.error_message, r.completed_at = "failed", f"Staging failed: {e}", now()
                continue
            targets.append(t)
        job.status = JobStatus.RUNNING.value
        job.started_at = job.started_at or now()
        db.commit()
        by_host = {t.hostname: t.result_id for t in targets}

    if not targets:
        with db_factory() as db:
            job = db.get(XmlJob, job_id)
            recompute(db, job)
        return

    def on_started(host: str) -> None:
        with db_factory() as s:
            r = s.get(JobResult, by_host[host])
            if r and r.status == "pending":
                r.status, r.started_at = "running", now()

    def on_failed(host: str, msg: str) -> None:
        with db_factory() as s:
            r = s.get(JobResult, by_host[host])
            if r:
                r.error_message = msg

    try:
        outcome = AnsibleService().run(job_id, targets, on_started, on_failed,
                                       should_cancel=lambda: bool(redis.exists(cancel_key(job_id))))
    except AnsibleConfigError as e:
        outcome = None
        fatal = str(e)
    else:
        fatal = outcome.fatal_error

    with db_factory() as db:
        job = db.get(XmlJob, job_id)
        for t in targets:
            r = db.get(JobResult, t.result_id)
            if outcome and t.hostname in outcome.hosts:
                h = outcome.hosts[t.hostname]
                r.status = "success" if h.ok else ("cancelled" if h.error == "Cancelled by user" else "failed")
                r.output, r.error_message = h.output, h.error
            else:
                r.status, r.error_message = "failed", fatal or "Unknown error"
            r.started_at = r.started_at or now()
            r.completed_at = now()
            if r.pos and r.status == "success":
                r.pos.last_deployment_at = r.completed_at
            if r.status == "failed":
                audit.record(db, audit.AuditAction.DEPLOYMENT_HOST_FAILED, username="system",
                             target=f"deployment #{job_id} / {r.hostname}",
                             details={"error": (r.error_message or "")[:500], "attempt": r.attempt})
        if fatal:
            job.error_message = fatal
        recompute(db, job)
        action = (audit.AuditAction.DEPLOYMENT_COMPLETED if job.status in ("success", "partial", "cancelled")
                  else audit.AuditAction.DEPLOYMENT_FAILED)
        audit.record(db, action, username="system", target=f"deployment #{job_id}", details={
            "status": job.status, "successful": job.successful_devices, "failed": job.failed_devices,
            "run_id": outcome.run_id if outcome else None,
        })
    redis.delete(cancel_key(job_id))
