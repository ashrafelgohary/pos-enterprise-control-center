"""Password hashing (Argon2id), JWT issue/verify, CSRF helpers."""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import settings

_ph = PasswordHasher()  # Argon2id with library-recommended parameters
# Pre-computed hash used to equalise timing when the username does not exist
_DUMMY_HASH = _ph.hash(secrets.token_urlsafe(16))

ACCESS_COOKIE = "pcc_session"
CSRF_COOKIE = "pcc_csrf"
CSRF_HEADER = "X-CSRF-Token"


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _ph.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


def _csrf_digest(csrf: str) -> str:
    return hmac.new(settings.secret_key.encode(), csrf.encode(), hashlib.sha256).hexdigest()


def create_session_token(user_id: int, token_version: int) -> tuple[str, str, datetime]:
    """Return (jwt, csrf_token, expires_at). The CSRF token is bound to the JWT via its HMAC."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=settings.access_token_ttl_minutes)
    csrf = secrets.token_urlsafe(32)
    payload = {
        "sub": str(user_id),
        "ver": token_version,
        "jti": uuid.uuid4().hex,
        "csrf": _csrf_digest(csrf),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "iss": "pos-control-center",
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm), csrf, exp


def decode_session_token(token: str) -> dict:
    return jwt.decode(
        token, settings.secret_key, algorithms=[settings.jwt_algorithm],
        issuer="pos-control-center", options={"require": ["exp", "sub", "jti", "csrf"]},
    )


def csrf_valid(claims: dict, header_value: str | None) -> bool:
    if not header_value:
        return False
    return hmac.compare_digest(claims.get("csrf", ""), _csrf_digest(header_value))
