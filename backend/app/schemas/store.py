from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

_SPLIT_RECIPIENTS = re.compile(r"[,;\n]+")


class StoreBase(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    code: str | None = Field(default=None, max_length=50)
    brand: str = Field(min_length=1, max_length=100)
    email: EmailStr | None = None
    additional_recipients: list[EmailStr] = Field(default_factory=list)
    is_active: bool = True

    @field_validator("name", "brand", mode="before")
    @classmethod
    def strip_required(cls, value: Any) -> Any:
        return value.strip() if isinstance(value, str) else value

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value: Any) -> Any:
        if value is None:
            return None
        value = str(value).strip().upper()
        return value or None

    @field_validator("email", mode="before")
    @classmethod
    def blank_email_is_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("additional_recipients", mode="before")
    @classmethod
    def parse_recipients(cls, value: Any) -> Any:
        if value is None or value == "":
            return []
        if isinstance(value, str):
            return [part.strip() for part in _SPLIT_RECIPIENTS.split(value) if part.strip()]
        return value


class StoreCreate(StoreBase):
    pass


class StoreUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    code: str | None = Field(default=None, max_length=50)
    brand: str | None = Field(default=None, min_length=1, max_length=100)
    email: EmailStr | None = None
    additional_recipients: list[EmailStr] | None = None
    is_active: bool | None = None

    @field_validator("code", mode="before")
    @classmethod
    def normalize_code(cls, value: Any) -> Any:
        if value is None:
            return None
        value = str(value).strip().upper()
        return value or None

    @field_validator("email", mode="before")
    @classmethod
    def blank_email_is_none(cls, value: Any) -> Any:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("additional_recipients", mode="before")
    @classmethod
    def parse_recipients(cls, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, str):
            return [part.strip() for part in _SPLIT_RECIPIENTS.split(value) if part.strip()]
        return value


class StorePOSSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hostname: str
    ip_address: str | None = None
    mac_address: str | None = None

    @field_validator("ip_address", "mac_address", mode="before")
    @classmethod
    def _to_text(cls, value: Any) -> Any:
        # psycopg returns INET/MACADDR as objects (e.g. IPv4Address) -> plain text, no /32
        return None if value is None else str(value).split("/")[0]


class StoreRead(StoreBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    pos_terminals: list[StorePOSSummary] = Field(default_factory=list)
    notification_ready: bool


class StoreListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str | None
    brand: str
    email: EmailStr | None
    additional_recipients: list[EmailStr]
    is_active: bool
    notification_ready: bool
    pos_count: int = 0


class POSStoreAssignment(BaseModel):
    store_id: int | None
