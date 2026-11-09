import enum
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import INET, MACADDR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin


class PosStatus(str, enum.Enum):
    ONLINE = "online"
    OFFLINE = "offline"
    UNKNOWN = "unknown"
    MAINTENANCE = "maintenance"


class PosDevice(TimestampMixin, Base):
    __tablename__ = "pos_devices"
    __table_args__ = (
        CheckConstraint("status IN ('online','offline','unknown','maintenance')", name="status_valid"),
        CheckConstraint("hostname ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$'", name="hostname_format"),
        Index("ix_pos_devices_store_status", "store_name", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    hostname: Mapped[str] = mapped_column(String(63), unique=True, nullable=False)
    ip_address: Mapped[str] = mapped_column(INET, unique=True, nullable=False)
    mac_address: Mapped[str | None] = mapped_column(MACADDR)
    store_name: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    brand: Mapped[str | None] = mapped_column(String(64), index=True)
    notes: Mapped[str | None] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=PosStatus.UNKNOWN.value, index=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_deployment_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    store_id: Mapped[int | None] = mapped_column(
        ForeignKey("stores.id", ondelete="SET NULL"), nullable=True, index=True)
    store = relationship("Store", back_populates="pos_terminals", lazy="joined")


# Case-insensitive uniqueness / lookup for XML filename matching
Index("ix_pos_devices_hostname_lower", func.lower(PosDevice.hostname), unique=True)
