import ipaddress
import re
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import ORMModel

HOSTNAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$")
MAC_RE = re.compile(r"^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$")
PosStatusName = Literal["online", "offline", "unknown", "maintenance"]


def _validate_hostname(v: str) -> str:
    v = v.strip()
    if not HOSTNAME_RE.fullmatch(v):
        raise ValueError("hostname may contain letters, digits, '.', '_' and '-' (max 63 chars)")
    return v


def _validate_ip(v: str) -> str:
    try:
        return str(ipaddress.ip_address(str(v).strip()))
    except ValueError as e:
        raise ValueError("invalid IP address") from e


def _validate_mac(v: str | None) -> str | None:
    if v is None or str(v).strip() == "":
        return None
    v = str(v).strip()
    if not MAC_RE.fullmatch(v):
        raise ValueError("invalid MAC address (expected aa:bb:cc:dd:ee:ff)")
    return v.replace("-", ":").lower()


class PosBase(BaseModel):
    hostname: str = Field(max_length=63)
    ip_address: str
    mac_address: str | None = None
    store_name: str = Field(min_length=1, max_length=128)
    brand: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=1000)

    _h = field_validator("hostname")(_validate_hostname)
    _i = field_validator("ip_address")(_validate_ip)
    _m = field_validator("mac_address")(_validate_mac)


class PosCreate(PosBase):
    status: PosStatusName = "unknown"


class PosUpdate(BaseModel):
    hostname: str | None = Field(default=None, max_length=63)
    ip_address: str | None = None
    mac_address: str | None = None
    store_name: str | None = Field(default=None, min_length=1, max_length=128)
    brand: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=1000)
    status: PosStatusName | None = None

    @field_validator("hostname")
    @classmethod
    def _h(cls, v):
        return None if v is None else _validate_hostname(v)

    @field_validator("ip_address")
    @classmethod
    def _i(cls, v):
        return None if v is None else _validate_ip(v)

    @field_validator("mac_address")
    @classmethod
    def _m(cls, v):
        return _validate_mac(v)


class PosOut(ORMModel):
    id: int
    hostname: str
    ip_address: str
    mac_address: str | None
    store_name: str
    brand: str | None
    notes: str | None
    status: str
    last_seen: datetime | None
    last_deployment_at: datetime | None
    store_id: int | None = None
    created_at: datetime
    updated_at: datetime

    @field_validator("ip_address", "mac_address", mode="before")
    @classmethod
    def _to_str(cls, v):
        # psycopg returns ipaddress objects for INET
        if v is None:
            return None
        return str(v).split("/")[0]


class BulkIds(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)


class ImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str]


class Facets(BaseModel):
    stores: list[str]
    brands: list[str]
