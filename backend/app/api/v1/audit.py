import csv
import io
import json
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.rbac import Permission
from app.db.session import get_db
from app.models import AuditLog, User
from app.schemas.audit import AuditOut
from app.schemas.common import Page

router = APIRouter(prefix="/audit-logs", tags=["audit"])
guard = require(Permission.AUDIT_READ)


def _query(q, action, username, date_from, date_to):
    stmt = select(AuditLog)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(AuditLog.target.ilike(like), AuditLog.username.ilike(like), AuditLog.action.ilike(like)))
    if action:
        stmt = stmt.where(AuditLog.action.like(f"{action}%"))
    if username:
        stmt = stmt.where(AuditLog.username == username)
    if date_from:
        stmt = stmt.where(AuditLog.timestamp >= date_from)
    if date_to:
        stmt = stmt.where(AuditLog.timestamp <= date_to)
    return stmt


def _safe(s: str) -> str:
    return ("'" + s) if s and s[0] in "=+-@" else s


@router.get("", response_model=Page[AuditOut])
def list_logs(q: str | None = Query(None, max_length=100), action: str | None = Query(None, max_length=64),
              username: str | None = None, date_from: datetime | None = None, date_to: datetime | None = None,
              page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=500),
              db: Session = Depends(get_db), _: User = Depends(guard)):
    stmt = _query(q, action, username, date_from, date_to)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(AuditLog.id.desc()).offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/actions", response_model=list[str])
def actions(db: Session = Depends(get_db), _: User = Depends(guard)):
    return db.scalars(select(distinct(AuditLog.action)).order_by(AuditLog.action)).all()


@router.get("/export")
def export(q: str | None = None, action: str | None = None, username: str | None = None,
           date_from: datetime | None = None, date_to: datetime | None = None,
           db: Session = Depends(get_db), _: User = Depends(guard)):
    rows = db.scalars(_query(q, action, username, date_from, date_to).order_by(AuditLog.id.desc()).limit(100_000)).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["timestamp", "user", "action", "target", "ip", "details"])
    for r in rows:
        w.writerow([r.timestamp.isoformat(), _safe(r.username or ""), r.action, _safe(r.target or ""), r.ip_address or "",
                    _safe(json.dumps(r.details) if r.details else "")])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="audit-log.csv"'})
