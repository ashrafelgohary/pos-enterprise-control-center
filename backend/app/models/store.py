from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base

if TYPE_CHECKING:
    from app.models.pos import PosDevice


class Store(Base):
    __tablename__ = "stores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    code: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)
    brand: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    # Comma/newline separated email addresses; normalized by the API before persistence.
    additional_recipients: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )

    pos_terminals: Mapped[list["PosDevice"]] = relationship(
        "PosDevice", back_populates="store", passive_deletes=True
    )

    @property
    def notification_ready(self) -> bool:
        return bool(self.email)
