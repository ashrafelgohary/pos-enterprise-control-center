from __future__ import annotations

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

# Adapt only these project-specific imports if your existing names differ.
from app.api.deps import require
from app.core.rbac import Permission
from app.db.session import get_db
from app.models.pos import PosDevice
from app.models.store import Store
from app.schemas.store import POSStoreAssignment, StoreCreate, StoreListItem, StoreRead, StoreUpdate

router = APIRouter(prefix="/stores", tags=["stores"])
AdminUser = Annotated[object, Depends(require(Permission.USERS_MANAGE))]
DbSession = Annotated[Session, Depends(get_db)]
_SPLIT_RECIPIENTS = re.compile(r"[,;\n]+")


def _encode_recipients(values: list[str]) -> str | None:
    normalized = list(dict.fromkeys(str(item).strip().lower() for item in values if str(item).strip()))
    return ",".join(normalized) or None


def _decode_recipients(value: str | None) -> list[str]:
    return [part.strip() for part in _SPLIT_RECIPIENTS.split(value or "") if part.strip()]


def _store_read(store: Store) -> dict:
    return {
        "id": store.id,
        "name": store.name,
        "code": store.code,
        "brand": store.brand,
        "email": store.email,
        "additional_recipients": _decode_recipients(store.additional_recipients),
        "is_active": store.is_active,
        "created_at": store.created_at,
        "updated_at": store.updated_at,
        "notification_ready": store.notification_ready,
        "pos_terminals": store.pos_terminals,
    }


@router.get("", response_model=list[StoreListItem])
def list_stores(
    _: AdminUser,
    db: DbSession,
    search: str | None = Query(default=None, max_length=160),
) -> list[dict]:
    pos_count = func.count(PosDevice.id).label("pos_count")
    stmt = (
        select(Store, pos_count)
        .outerjoin(PosDevice, PosDevice.store_id == Store.id)
        .group_by(Store.id)
        .order_by(Store.name.asc())
    )
    if search:
        term = f"%{search.strip()}%"
        stmt = stmt.where(
            Store.name.ilike(term) | Store.brand.ilike(term) | Store.code.ilike(term)
        )
    rows = db.execute(stmt).all()
    return [
        {
            "id": store.id,
            "name": store.name,
            "code": store.code,
            "brand": store.brand,
            "email": store.email,
            "additional_recipients": _decode_recipients(store.additional_recipients),
            "is_active": store.is_active,
            "notification_ready": store.notification_ready,
            "pos_count": count,
        }
        for store, count in rows
    ]


@router.post("", response_model=StoreRead, status_code=status.HTTP_201_CREATED)
def create_store(payload: StoreCreate, _: AdminUser, db: DbSession) -> dict:
    values = payload.model_dump(exclude={"additional_recipients"})
    store = Store(
        **{_k: _v for _k, _v in (values).items() if _k not in {'additional_recipients', 'email'}},
        email=str(payload.email).lower() if payload.email else None,
        additional_recipients=_encode_recipients(payload.additional_recipients),
    )
    db.add(store)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A store with this code already exists.") from exc
    db.refresh(store)
    store.pos_terminals = []
    return _store_read(store)


@router.get("/{store_id}", response_model=StoreRead)
def get_store(store_id: int, _: AdminUser, db: DbSession) -> dict:
    store = db.scalar(
        select(Store).where(Store.id == store_id).options(selectinload(Store.pos_terminals))
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")
    return _store_read(store)


@router.patch("/{store_id}", response_model=StoreRead)
def update_store(store_id: int, payload: StoreUpdate, _: AdminUser, db: DbSession) -> dict:
    store = db.scalar(
        select(Store).where(Store.id == store_id).options(selectinload(Store.pos_terminals))
    )
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")
    values = payload.model_dump(exclude_unset=True)
    if "email" in values:
        values["email"] = str(values["email"]).lower() if values["email"] else None
    if "additional_recipients" in values:
        values["additional_recipients"] = _encode_recipients(values["additional_recipients"] or [])
    for key, value in values.items():
        setattr(store, key, value)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="A store with this code already exists.") from exc
    db.refresh(store)
    return _store_read(store)


@router.delete("/{store_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def delete_store(store_id: int, _: AdminUser, db: DbSession) -> None:
    store = db.get(Store, store_id)
    if not store:
        raise HTTPException(status_code=404, detail="Store not found.")
    if db.scalar(select(func.count(PosDevice.id)).where(PosDevice.store_id == store_id)):
        raise HTTPException(
            status_code=409,
            detail="Reassign the store's POS terminals before deleting it.",
        )
    db.delete(store)
    db.commit()


@router.put("/pos/{pos_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None)
def assign_pos_to_store(
    pos_id: int,
    payload: POSStoreAssignment,
    _: AdminUser,
    db: DbSession,
) -> None:
    pos = db.get(PosDevice, pos_id)
    if not pos:
        raise HTTPException(status_code=404, detail="POS terminal not found.")
    if payload.store_id is not None and not db.get(Store, payload.store_id):
        raise HTTPException(status_code=404, detail="Store not found.")
    pos.store_id = payload.store_id
    db.commit()
