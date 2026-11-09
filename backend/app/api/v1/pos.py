from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import delete, distinct, func, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, require
from app.core.rbac import Permission
from app.db.session import get_db
from app.models import JobResult, PosDevice, User
from app.schemas.common import Page
from app.schemas.job import JobResultDetail
from app.schemas.pos import BulkIds, Facets, ImportResult, PosCreate, PosOut, PosUpdate
from app.services import audit_service as audit
from app.services import pos_service
from app.services.pos_service import DuplicatePosError

router = APIRouter(prefix="/pos", tags=["pos"])
MAX_IMPORT_BYTES = 5 * 1024 * 1024


def _get(db: Session, pos_id: int) -> PosDevice:
    pos = db.get(PosDevice, pos_id)
    if not pos:
        raise HTTPException(404, "POS not found")
    return pos


@router.get("", response_model=Page[PosOut])
def list_pos(
    q: str | None = Query(None, max_length=100), status: str | None = Query(None, pattern="^(online|offline|unknown|maintenance)$"),
    store: str | None = None, brand: str | None = None,
    sort: str = Query("hostname", pattern="^(hostname|ip_address|store_name|brand|status|last_seen|created_at)$"),
    order: Literal["asc", "desc"] = "asc", page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=500),
    db: Session = Depends(get_db), _: User = Depends(require(Permission.POS_READ)),
):
    items, total = pos_service.list_pos(db, q=q, status=status, store=store, brand=brand, sort=sort, order=order,
                                        page=page, page_size=page_size)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/facets", response_model=Facets)
def facets(db: Session = Depends(get_db), _: User = Depends(require(Permission.POS_READ))):
    stores = db.scalars(select(distinct(PosDevice.store_name)).order_by(PosDevice.store_name)).all()
    brands = db.scalars(select(distinct(PosDevice.brand)).where(PosDevice.brand.is_not(None)).order_by(PosDevice.brand)).all()
    return Facets(stores=stores, brands=brands)


@router.get("/lookup", response_model=list[PosOut])
def lookup(q: str = Query(..., min_length=1, max_length=63), db: Session = Depends(get_db),
           _: User = Depends(require(Permission.POS_READ))):
    """Typeahead used by the deployment page for manual matching."""
    items, _t = pos_service.list_pos(db, q=q, status=None, store=None, brand=None, sort="hostname", order="asc", page=1, page_size=20)
    return items


@router.get("/export")
def export(request: Request, q: str | None = None, status: str | None = None, store: str | None = None, brand: str | None = None,
           db: Session = Depends(get_db), user: User = Depends(require(Permission.POS_IMPORT))):
    rows = db.scalars(pos_service.build_query(q, status, store, brand).order_by(PosDevice.hostname)).all()
    audit.record(db, audit.AuditAction.POS_EXPORTED, user=user, target=f"{len(rows)} POS", ip=client_ip(request),
                 details={"filters": {"q": q, "status": status, "store": store, "brand": brand}})
    db.commit()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(pos_service.export_csv(rows), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="pos-devices-{stamp}.csv"'})


@router.post("/import", response_model=ImportResult)
async def import_pos(request: Request, file: UploadFile = File(...), update_existing: bool = Query(False),
                     db: Session = Depends(get_db), user: User = Depends(require(Permission.POS_IMPORT))):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(400, "Only .csv files are accepted")
    content = await file.read(MAX_IMPORT_BYTES + 1)
    if len(content) > MAX_IMPORT_BYTES:
        raise HTTPException(413, "CSV too large (max 5 MB)")
    result = pos_service.import_csv(db, content, update_existing=update_existing)
    audit.record(db, audit.AuditAction.POS_IMPORTED, user=user, target=file.filename, ip=client_ip(request),
                 details={k: v for k, v in result.items() if k != "errors"} | {"error_count": len(result["errors"])})
    db.commit()
    return result


@router.post("", response_model=PosOut, status_code=201)
def create(body: PosCreate, request: Request, db: Session = Depends(get_db), user: User = Depends(require(Permission.POS_WRITE))):
    try:
        pos = pos_service.create_pos(db, body)
    except DuplicatePosError as e:
        raise HTTPException(409, str(e))
    audit.record(db, audit.AuditAction.POS_CREATED, user=user, target=f"POS {pos.hostname}", ip=client_ip(request),
                 details=body.model_dump())
    db.commit()
    db.refresh(pos)
    return pos


@router.get("/{pos_id}", response_model=PosOut)
def get_pos(pos_id: int, db: Session = Depends(get_db), _: User = Depends(require(Permission.POS_READ))):
    return _get(db, pos_id)


@router.patch("/{pos_id}", response_model=PosOut)
def update(pos_id: int, body: PosUpdate, request: Request, db: Session = Depends(get_db),
           user: User = Depends(require(Permission.POS_WRITE))):
    pos = _get(db, pos_id)
    try:
        changes = pos_service.update_pos(db, pos, body)
    except DuplicatePosError as e:
        raise HTTPException(409, str(e))
    if changes:
        audit.record(db, audit.AuditAction.POS_UPDATED, user=user, target=f"POS {pos.hostname}", ip=client_ip(request),
                     details=changes)
    db.commit()
    db.refresh(pos)
    return pos


@router.delete("/{pos_id}", status_code=204)
def delete_one(pos_id: int, request: Request, db: Session = Depends(get_db), user: User = Depends(require(Permission.POS_DELETE))):
    pos = _get(db, pos_id)
    _ensure_not_busy(db, [pos_id])
    audit.record(db, audit.AuditAction.POS_DELETED, user=user, target=f"POS {pos.hostname}", ip=client_ip(request),
                 details={"ip_address": str(pos.ip_address).split("/")[0], "store": pos.store_name})
    db.delete(pos)
    db.commit()


@router.post("/bulk-delete", response_model=dict)
def bulk_delete(body: BulkIds, request: Request, db: Session = Depends(get_db), user: User = Depends(require(Permission.POS_DELETE))):
    _ensure_not_busy(db, body.ids)
    names = db.scalars(select(PosDevice.hostname).where(PosDevice.id.in_(body.ids))).all()
    db.execute(delete(PosDevice).where(PosDevice.id.in_(body.ids)))
    audit.record(db, audit.AuditAction.POS_DELETED, user=user, target=f"{len(names)} POS (bulk)", ip=client_ip(request),
                 details={"hostnames": names})
    db.commit()
    return {"deleted": len(names)}


@router.get("/{pos_id}/deployments", response_model=Page[JobResultDetail])
def history(pos_id: int, page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
            db: Session = Depends(get_db), _: User = Depends(require(Permission.JOBS_READ))):
    _get(db, pos_id)
    base = select(JobResult).where(JobResult.pos_id == pos_id)
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    items = db.scalars(base.order_by(JobResult.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=items, total=total, page=page, page_size=page_size)


def _ensure_not_busy(db: Session, ids: list[int]) -> None:
    from app.services.deployment_service import busy_pos_ids
    if busy_pos_ids(db, set(ids)):
        raise HTTPException(409, "Cannot delete POS devices with an active deployment")


# ---------------------------------------------------------------- live reachability
class ReachabilityRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


@router.post("/reachability")
def reachability(body: ReachabilityRequest, db: Session = Depends(get_db),
                 _: User = Depends(require(Permission.POS_READ))):
    """TCP check of the SSH port right now (same test as the scheduled health check).
    Updates status/last_seen so the rest of the app shows the fresh state."""
    import socket
    from concurrent.futures import ThreadPoolExecutor
    from app.core.config import settings

    rows = db.scalars(select(PosDevice).where(PosDevice.id.in_(body.ids))).all()

    def probe(ip: str) -> bool:
        try:
            with socket.create_connection((ip, settings.health_check_port), timeout=settings.health_check_timeout_seconds):
                return True
        except OSError:
            return False

    targets = [(p, str(p.ip_address).split("/")[0]) for p in rows]
    with ThreadPoolExecutor(max_workers=min(32, max(1, len(targets)))) as pool:
        results = list(pool.map(lambda t: probe(t[1]), targets))
    now = datetime.now(timezone.utc)
    out = {}
    for (pos, _ip), ok in zip(targets, results):
        if pos.status != "maintenance":
            pos.status = "online" if ok else "offline"
        if ok:
            pos.last_seen = now
        out[pos.id] = {"online": ok, "status": pos.status,
                       "last_seen": pos.last_seen.isoformat() if pos.last_seen else None}
    db.commit()
    return {"checked_at": now.isoformat(), "results": out}
