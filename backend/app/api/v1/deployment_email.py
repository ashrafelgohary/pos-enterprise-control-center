from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session, joinedload

# Adapt the Deployment import/name to the existing job model if required.
from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.job import JobResult
from app.models.pos import PosDevice
from app.services.deployment_email import (
    DEFAULT_NOTIFICATION_CC,
    SUCCESS_STATES,
    DeploymentEmailDetails,
    build_preview,
)

router = APIRouter(prefix="/deployments", tags=["deployments"])
DbSession = Annotated[Session, Depends(get_db)]
CurrentUser = Annotated[object, Depends(get_current_user)]
_SPLIT = re.compile(r"[,;\n]+")


class EmailPreviewResponse(BaseModel):
    ready: bool
    to: list[str]
    cc: list[str]
    subject: str
    body_text: str
    body_html: str
    warning: str | None
    store_id: int | None
    configuration_url: str | None
    details: dict[str, Any]


def _first(value: Any, *names: str, default: Any = None) -> Any:
    for name in names:
        candidate = getattr(value, name, None)
        if candidate is not None:
            return candidate
    return default


def _cc(db: Session) -> list[str]:
    value = db.execute(
        text("SELECT value FROM application_settings WHERE key = 'deployment_email_default_cc'")
    ).scalar_one_or_none()
    return [part.strip() for part in _SPLIT.split(value or DEFAULT_NOTIFICATION_CC) if part.strip()]


@router.get("/{deployment_id}/email-preview", response_model=EmailPreviewResponse)
def deployment_email_preview(
    deployment_id: int,
    _: CurrentUser,
    db: DbSession,
) -> dict:
    # Keep the eager-load path in sync with the existing Deployment relationship name.
    deployment = db.scalar(
        select(JobResult)
        .where(JobResult.id == deployment_id)
        .options(joinedload(JobResult.pos).joinedload(PosDevice.store))
    )
    if not deployment:
        raise HTTPException(status_code=404, detail="Deployment not found.")

    raw_status = _first(deployment, "status", "result", default="")
    deployment_status = str(getattr(raw_status, "value", raw_status)).lower()
    if deployment_status not in SUCCESS_STATES:
        raise HTTPException(
            status_code=409,
            detail="Email preview is available only after a confirmed successful deployment.",
        )

    pos = _first(deployment, "pos_terminal", "pos")
    if not pos:
        raise HTTPException(status_code=409, detail="Deployment has no POS terminal information.")
    store = getattr(pos, "store", None)

    deployed_at = _first(
        deployment,
        "completed_at",
        "finished_at",
        "updated_at",
        default=datetime.now(timezone.utc),
    )
    details = DeploymentEmailDetails(
        store_name=_first(store, "name", default="Unassigned store") if store else "Unassigned store",
        brand=_first(store, "brand", default="Not available") if store else "Not available",
        pos_hostname=str(_first(pos, "hostname", "name", default="Unknown POS")),
        pos_ip=str(_first(pos, "ip_address", "ip", default="Not available")),
        pos_mac=str(_first(pos, "mac_address", "mac", default="Not available")),
        xml_filename=str(
            _first(deployment, "xml_filename", "filename", "configuration_filename", default="Not available")
        ),
        deployed_at=deployed_at,
    )
    preview = build_preview(
        details=details,
        store_id=getattr(store, "id", None),
        store_email=getattr(store, "email", None),
        additional_recipients=(
            [part.strip() for part in _SPLIT.split(getattr(store, "additional_recipients", "") or "") if part.strip()]
            if store
            else []
        ),
        cc=_cc(db),
        configuration_url=f"/administration/stores/{store.id}" if store else "/administration/stores",
    )
    return {
        "ready": preview.ready,
        "to": preview.to,
        "cc": preview.cc,
        "subject": preview.subject,
        "body_text": preview.body_text,
        "body_html": preview.body_html,
        "warning": preview.warning,
        "store_id": preview.store_id,
        "configuration_url": preview.configuration_url,
        "details": preview.details,
    }
