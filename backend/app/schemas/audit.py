from datetime import datetime

from app.schemas.common import ORMModel


class AuditOut(ORMModel):
    id: int
    user_id: int | None
    username: str | None
    action: str
    target: str | None
    details: dict | None
    ip_address: str | None
    timestamp: datetime
