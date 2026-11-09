from datetime import datetime
from typing import Annotated, Literal

import email_validator
from email_validator import EmailNotValidError, validate_email
from pydantic import AfterValidator, BaseModel, Field

from app.schemas.common import ORMModel

# Allow internal AD-style domains (e.g. user@corp.local)
email_validator.SPECIAL_USE_DOMAIN_NAMES = [d for d in email_validator.SPECIAL_USE_DOMAIN_NAMES if d not in ("local", "test")]


def _email(v: str) -> str:
    # Internal domains such as corp.local are valid here (no deliverability / special-use checks)
    try:
        return validate_email(v, check_deliverability=False, globally_deliverable=False).normalized.lower()
    except EmailNotValidError as e:
        raise ValueError(str(e)) from e


EmailStr = Annotated[str, Field(max_length=255), AfterValidator(_email)]
RoleName = Literal["admin", "operator", "viewer"]
USERNAME_RE = r"^[A-Za-z0-9._-]{3,64}$"


class UserOut(ORMModel):
    id: int
    username: str
    email: str
    full_name: str | None
    role: str
    is_active: bool
    last_login_at: datetime | None
    created_at: datetime
    updated_at: datetime


class UserCreate(BaseModel):
    username: str = Field(pattern=USERNAME_RE)
    email: EmailStr
    full_name: str | None = Field(default=None, max_length=128)
    role: RoleName = "viewer"
    password: str = Field(min_length=1, max_length=256)


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, max_length=128)
    role: RoleName | None = None
    is_active: bool | None = None


class PasswordReset(BaseModel):
    new_password: str = Field(min_length=1, max_length=256)


class RoleOut(BaseModel):
    name: str
    permissions: list[str]


class PermissionOut(BaseModel):
    key: str
    label: str
