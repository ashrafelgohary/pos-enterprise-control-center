from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.rbac import Permission
from app.db.session import get_db
from app.services.deployment_email import DEFAULT_NOTIFICATION_CC

router = APIRouter(prefix="/settings/deployment-email", tags=["settings"])
AdminUser = Annotated[object, Depends(require(Permission.USERS_MANAGE))]
DbSession = Annotated[Session, Depends(get_db)]
SETTING_KEY = "deployment_email_default_cc"
_SPLIT = re.compile(r"[,;\n]+")


class DeploymentEmailSettings(BaseModel):
    default_cc: list[EmailStr] = Field(default_factory=lambda: [DEFAULT_NOTIFICATION_CC])

    @field_validator("default_cc", mode="before")
    @classmethod
    def parse_default_cc(cls, value):
        if isinstance(value, str):
            value = [part.strip() for part in _SPLIT.split(value) if part.strip()]
        return value


def _get_value(db: Session) -> list[str]:
    value = db.execute(
        text("SELECT value FROM application_settings WHERE key = :key"), {"key": SETTING_KEY}
    ).scalar_one_or_none()
    return [part.strip() for part in _SPLIT.split(value or DEFAULT_NOTIFICATION_CC) if part.strip()]


@router.get("", response_model=DeploymentEmailSettings)
def get_deployment_email_settings(_: AdminUser, db: DbSession) -> dict:
    return {"default_cc": _get_value(db)}


@router.put("", response_model=DeploymentEmailSettings)
def update_deployment_email_settings(
    payload: DeploymentEmailSettings,
    _: AdminUser,
    db: DbSession,
) -> dict:
    value = ",".join(dict.fromkeys(str(item).strip().lower() for item in payload.default_cc))
    db.execute(
        text(
            "INSERT INTO application_settings (key, value, updated_at) "
            "VALUES (:key, :value, CURRENT_TIMESTAMP) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP"
        ),
        {"key": SETTING_KEY, "value": value},
    )
    db.commit()
    return {"default_cc": _get_value(db)}
