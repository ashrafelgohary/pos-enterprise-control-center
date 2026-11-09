from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.rbac import Permission, has_permission
from app.db.session import get_db
from app.models import AuditLog, JobResult, PosDevice, User, XmlJob

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(require(Permission.POS_READ))):
    pos_counts = dict(db.execute(select(PosDevice.status, func.count()).group_by(PosDevice.status)).all())
    job_counts = dict(db.execute(select(XmlJob.status, func.count()).group_by(XmlJob.status)).all())

    since = datetime.now(timezone.utc) - timedelta(days=13)
    day = func.date_trunc("day", JobResult.completed_at)
    trend_rows = db.execute(
        select(day.label("d"),
               func.sum(case((JobResult.status == "success", 1), else_=0)),
               func.sum(case((JobResult.status == "failed", 1), else_=0)))
        .where(JobResult.completed_at >= since.replace(hour=0, minute=0, second=0, microsecond=0))
        .group_by("d").order_by("d")
    ).all()
    trend_map = {r[0].date().isoformat(): (int(r[1] or 0), int(r[2] or 0)) for r in trend_rows}
    trend = []
    for i in range(14):
        d = (since + timedelta(days=i)).date().isoformat()
        ok, bad = trend_map.get(d, (0, 0))
        trend.append({"date": d, "success": ok, "failed": bad})

    offline_sum = func.sum(case((PosDevice.status == "offline", 1), else_=0))
    stores = db.execute(
        select(PosDevice.store_name, func.count(), offline_sum)
        .group_by(PosDevice.store_name).order_by(offline_sum.desc(), func.count().desc()).limit(8)
    ).all()

    recent_jobs = db.scalars(select(XmlJob).order_by(XmlJob.id.desc()).limit(6)).all()
    if has_permission(user.role, Permission.AUDIT_READ):
        activity = [{"id": a.id, "username": a.username, "action": a.action, "target": a.target, "timestamp": a.timestamp}
                    for a in db.scalars(select(AuditLog).where(AuditLog.action.not_like("auth.%"))
                                        .order_by(AuditLog.id.desc()).limit(10))]
    else:
        activity = [{"id": j.id, "username": j.user.username if j.user else None, "action": f"deployment.{j.status}",
                     "target": f"deployment #{j.id}", "timestamp": j.created_at} for j in recent_jobs]

    return {
        "pos": {
            "total": sum(pos_counts.values()),
            "online": pos_counts.get("online", 0),
            "offline": pos_counts.get("offline", 0),
            "unknown": pos_counts.get("unknown", 0),
            "maintenance": pos_counts.get("maintenance", 0),
        },
        "jobs": {
            "pending": job_counts.get("pending", 0) + job_counts.get("running", 0),
            "running": job_counts.get("running", 0),
            "successful": job_counts.get("success", 0),
            "partial": job_counts.get("partial", 0),
            "failed": job_counts.get("failed", 0),
            "total": sum(job_counts.values()),
        },
        "trend": trend,
        "stores": [{"store": s, "total": t, "offline": int(o or 0)} for s, t, o in stores],
        "recent_jobs": [{"id": j.id, "filename": j.filename, "status": j.status, "total": j.total_devices,
                         "successful": j.successful_devices, "failed": j.failed_devices, "created_at": j.created_at,
                         "user": j.user.username if j.user else None} for j in recent_jobs],
        "activity": activity,
    }
