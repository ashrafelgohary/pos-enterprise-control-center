from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import clear_session_cookies, client_ip, get_current_user, set_session_cookies
from app.core import rate_limit
from app.core.config import settings
from app.core.rbac import permissions_for
from app.core.redis_client import get_redis
from app.core.security import hash_password, needs_rehash, verify_password
from app.db.session import get_db
from app.models import User
from app.schemas.auth import ChangePasswordRequest, LoginRequest, MeResponse
from app.services import audit_service as audit
from app.services.password_policy import validate_password

router = APIRouter(prefix="/auth", tags=["auth"])
GENERIC = "Invalid username or password"


def _me(u: User) -> MeResponse:
    return MeResponse(id=u.id, username=u.username, email=u.email, full_name=u.full_name, role=u.role,
                      permissions=permissions_for(u.role))


@router.post("/login", response_model=MeResponse)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    ip = client_ip(request) or "unknown"
    ident = body.username.strip()
    if not settings.local_login_enabled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Local sign-in is disabled. Use SSO.")
    if not rate_limit.hit_ip(ip):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many login attempts. Try again in a minute.")
    if rate_limit.is_locked(ident):
        audit.record(db, audit.AuditAction.LOGIN_FAILED, username=ident[:64], ip=ip, details={"reason": "locked"})
        db.commit()
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            f"Account temporarily locked. Try again in {settings.login_lockout_minutes} minutes.")
    user = db.scalar(select(User).where(or_(func.lower(User.username) == ident.lower(),
                                            func.lower(User.email) == ident.lower())))
    ok = verify_password(body.password, user.password_hash if user else None)
    if not ok or not user or not user.is_active:
        rate_limit.register_failure(ident)
        audit.record(db, audit.AuditAction.LOGIN_FAILED, user=user if user else None, username=ident[:64], ip=ip,
                     details={"reason": "inactive" if user and ok else "bad_credentials"})
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC)
    rate_limit.reset_failures(ident)
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    user.last_login_at = datetime.now(timezone.utc)
    audit.record(db, audit.AuditAction.LOGIN_SUCCESS, user=user, ip=ip)
    db.commit()
    set_session_cookies(response, user)
    return _me(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    claims = request.state.claims
    ttl = max(1, int(claims["exp"] - datetime.now(timezone.utc).timestamp()))
    get_redis().set(f"revoked:{claims['jti']}", "1", ex=ttl)
    audit.record(db, audit.AuditAction.LOGOUT, user=user, ip=client_ip(request))
    db.commit()
    clear_session_cookies(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=MeResponse)
def me(user: User = Depends(get_current_user)):
    return _me(user)


@router.post("/change-password", status_code=204)
def change_password(body: ChangePasswordRequest, request: Request, response: Response,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(400, "Current password is incorrect")
    validate_password(body.new_password, user.username)
    user.password_hash = hash_password(body.new_password)
    user.token_version += 1   # sign out every other session
    audit.record(db, audit.AuditAction.PASSWORD_CHANGED, user=user, ip=client_ip(request))
    db.commit()
    set_session_cookies(response, user)
    response.status_code = 204
    return response
