from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import client_ip, require
from app.core.rbac import PERMISSION_LABELS, Permission, Role, permissions_for
from app.core.security import hash_password
from app.db.session import get_db
from app.models import User
from app.schemas.common import Page
from app.schemas.user import PasswordReset, PermissionOut, RoleOut, UserCreate, UserOut, UserUpdate
from app.services import audit_service as audit
from app.services.password_policy import validate_password

router = APIRouter(tags=["users"])
admin_only = require(Permission.USERS_MANAGE)


@router.get("/roles", response_model=dict)
def roles(_: User = Depends(require(Permission.POS_READ))):
    return {
        "roles": [RoleOut(name=r.value, permissions=permissions_for(r.value)).model_dump() for r in Role],
        "permissions": [PermissionOut(key=p.value, label=PERMISSION_LABELS[p]).model_dump() for p in Permission],
    }


@router.get("/users", response_model=Page[UserOut])
def list_users(q: str | None = Query(None, max_length=100), role: str | None = None, page: int = Query(1, ge=1),
               page_size: int = Query(25, ge=1, le=200), db: Session = Depends(get_db), _: User = Depends(admin_only)):
    stmt = select(User)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(User.username.ilike(like), User.email.ilike(like), User.full_name.ilike(like)))
    if role:
        stmt = stmt.where(User.role == role)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(User.username).offset((page - 1) * page_size).limit(page_size)).all()
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.post("/users", response_model=UserOut, status_code=201)
def create_user(body: UserCreate, request: Request, db: Session = Depends(get_db), admin: User = Depends(admin_only)):
    validate_password(body.password, body.username)
    u = User(username=body.username, email=body.email.lower(), full_name=body.full_name, role=body.role,
             password_hash=hash_password(body.password))
    db.add(u)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Username or email already exists")
    audit.record(db, audit.AuditAction.USER_CREATED, user=admin, target=f"user {u.username}", ip=client_ip(request),
                 details={"role": u.role, "email": u.email})
    db.commit()
    return u


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(user_id: int, body: UserUpdate, request: Request, db: Session = Depends(get_db),
                admin: User = Depends(admin_only)):
    u = db.get(User, user_id) or _404()
    data = body.model_dump(exclude_unset=True)
    if u.id == admin.id and (data.get("is_active") is False or (data.get("role") and data["role"] != "admin")):
        raise HTTPException(400, "You cannot deactivate or demote your own account")
    if u.role == "admin" and (data.get("is_active") is False or data.get("role", "admin") != "admin"):
        if db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.is_active)) <= 1:
            raise HTTPException(400, "At least one active administrator is required")
    changes = {}
    for k, v in data.items():
        if k == "email" and v:
            v = v.lower()
        if getattr(u, k) != v:
            changes[k] = {"from": getattr(u, k), "to": v}
            setattr(u, k, v)
    if "is_active" in changes or "role" in changes:
        u.token_version += 1  # force re-login with new privileges
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Email already in use")
    action = audit.AuditAction.USER_DEACTIVATED if changes.get("is_active", {}).get("to") is False else audit.AuditAction.USER_UPDATED
    audit.record(db, action, user=admin, target=f"user {u.username}", ip=client_ip(request), details=changes)
    db.commit()
    return u


@router.post("/users/{user_id}/reset-password", status_code=204)
def reset_password(user_id: int, body: PasswordReset, request: Request, db: Session = Depends(get_db),
                   admin: User = Depends(admin_only)):
    u = db.get(User, user_id) or _404()
    validate_password(body.new_password, u.username)
    u.password_hash = hash_password(body.new_password)
    u.token_version += 1
    audit.record(db, audit.AuditAction.USER_PASSWORD_RESET, user=admin, target=f"user {u.username}", ip=client_ip(request))
    db.commit()


def _404():
    raise HTTPException(404, "User not found")
