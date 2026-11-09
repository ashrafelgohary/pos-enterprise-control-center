"""Audit trail writer. Call inside the same transaction as the action being audited."""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models import AuditLog, User


class AuditAction:
    LOGIN_SUCCESS = "auth.login"
    LOGIN_FAILED = "auth.login_failed"
    LOGOUT = "auth.logout"
    PASSWORD_CHANGED = "auth.password_changed"
    USER_CREATED = "user.created"
    USER_UPDATED = "user.updated"
    USER_DEACTIVATED = "user.deactivated"
    USER_PASSWORD_RESET = "user.password_reset"
    POS_CREATED = "pos.created"
    POS_UPDATED = "pos.updated"
    POS_DELETED = "pos.deleted"
    POS_IMPORTED = "pos.imported"
    POS_EXPORTED = "pos.exported"
    XML_UPLOADED = "xml.uploaded"
    DEPLOYMENT_STARTED = "deployment.started"
    DEPLOYMENT_COMPLETED = "deployment.completed"
    DEPLOYMENT_FAILED = "deployment.failed"
    DEPLOYMENT_HOST_FAILED = "deployment.host_failed"
    DEPLOYMENT_RETRIED = "deployment.retried"
    DEPLOYMENT_CANCELLED = "deployment.cancelled"


def record(
    db: Session,
    action: str,
    *,
    user: User | None = None,
    target: str | None = None,
    details: dict[str, Any] | None = None,
    ip: str | None = None,
    username: str | None = None,
) -> AuditLog:
    entry = AuditLog(
        user_id=user.id if user else None,
        username=user.username if user else username,
        action=action,
        target=(target or "")[:255] or None,
        details=details,
        ip_address=ip,
    )
    db.add(entry)
    return entry
