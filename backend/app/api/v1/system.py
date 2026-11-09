from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.config import settings
from app.core.rbac import Permission
from app.core.redis_client import get_redis
from app.db.session import get_db
from app.models import User
from app.worker.celery_app import celery_app

router = APIRouter(tags=["system"])


@router.get("/health")
def liveness():
    return {"status": "ok"}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    get_redis().ping()
    return {"status": "ready"}


@router.get("/system/info")
def info(_: User = Depends(require(Permission.SYSTEM_READ))):
    try:
        workers = list((celery_app.control.inspect(timeout=1.0).ping() or {}).keys())
    except Exception:  # noqa: BLE001
        workers = []
    # Non-secret configuration only
    return {
        "app_name": settings.app_name,
        "environment": settings.environment,
        "workers": workers,
        "ansible": {
            "playbook": settings.ansible_playbook,
            "inventory_group": settings.ansible_inventory_group,
            "auth_mode": settings.ansible_auth_mode,
            "forks": settings.ansible_forks,
            "timeout_seconds": settings.ansible_timeout_seconds,
            "host_key_checking": settings.ansible_host_key_checking,
            "var_map": settings.ansible_var_map,
            "staging": bool(settings.ansible_stage_path_template),
        },
        "uploads": {"max_xml_size_mb": settings.max_xml_size_mb, "max_files_per_upload": settings.max_files_per_upload},
        "health_check": {"enabled": settings.health_check_enabled, "interval_seconds": settings.health_check_interval_seconds,
                         "port": settings.health_check_port},
    }
