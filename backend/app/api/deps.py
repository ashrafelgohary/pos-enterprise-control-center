"""Authentication / authorisation dependencies."""
from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.rbac import Permission, has_permission
from app.core.redis_client import get_redis
from app.core.security import ACCESS_COOKIE, CSRF_COOKIE, CSRF_HEADER, create_session_token, csrf_valid, decode_session_token
from app.db.session import get_db
from app.models import User

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def client_ip(request: Request) -> str | None:
    # Real client IP: gunicorn --forwarded-allow-ips trusts X-Forwarded-For from our nginx only
    return request.client.host if request.client else None


def set_session_cookies(response: Response, user: User) -> None:
    token, csrf, _exp = create_session_token(user.id, user.token_version)
    max_age = settings.access_token_ttl_minutes * 60
    common = dict(secure=settings.cookie_secure, samesite="strict", domain=settings.cookie_domain, path="/")
    response.set_cookie(ACCESS_COOKIE, token, httponly=True, max_age=max_age, **common)
    response.set_cookie(CSRF_COOKIE, csrf, httponly=False, max_age=max_age, **common)  # readable by SPA


def clear_session_cookies(response: Response) -> None:
    for c in (ACCESS_COOKIE, CSRF_COOKIE):
        response.delete_cookie(c, path="/", domain=settings.cookie_domain)


def _unauth(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail=detail)


def get_current_user(request: Request, response: Response, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(ACCESS_COOKIE)
    if not token:
        raise _unauth()
    try:
        claims = decode_session_token(token)
    except jwt.PyJWTError:
        raise _unauth("Session expired")
    if get_redis().exists(f"revoked:{claims['jti']}"):
        raise _unauth("Session revoked")
    if request.method in UNSAFE and not csrf_valid(claims, request.headers.get(CSRF_HEADER)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")
    user = db.get(User, int(claims["sub"]))
    if not user or not user.is_active or user.token_version != claims.get("ver"):
        raise _unauth("Session no longer valid")
    # Sliding session: refresh when past half of the lifetime
    remaining = claims["exp"] - datetime.now(timezone.utc).timestamp()
    if remaining < settings.access_token_ttl_minutes * 30:
        set_session_cookies(response, user)
    request.state.user = user
    request.state.claims = claims
    return user


def require(*perms: Permission) -> Callable[..., User]:
    def checker(user: User = Depends(get_current_user)) -> User:
        for p in perms:
            if not has_permission(user.role, p):
                raise HTTPException(status.HTTP_403_FORBIDDEN, detail="You do not have permission to perform this action")
        return user
    return checker
