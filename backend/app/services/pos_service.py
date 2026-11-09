from __future__ import annotations

import csv
import io

from pydantic import ValidationError
from sqlalchemy import String, asc, cast, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import PosDevice
from app.schemas.pos import PosCreate, PosUpdate

SORTABLE = {
    "hostname": PosDevice.hostname,
    "ip_address": PosDevice.ip_address,
    "store_name": PosDevice.store_name,
    "brand": PosDevice.brand,
    "status": PosDevice.status,
    "last_seen": PosDevice.last_seen,
    "created_at": PosDevice.created_at,
}
CSV_FIELDS = ["hostname", "ip_address", "mac_address", "store_name", "brand", "notes"]


class DuplicatePosError(Exception):
    pass


def build_query(q: str | None, status: str | None, store: str | None, brand: str | None):
    stmt = select(PosDevice)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            PosDevice.hostname.ilike(like),
            cast(PosDevice.ip_address, String).ilike(like),
            cast(PosDevice.mac_address, String).ilike(like),
            PosDevice.store_name.ilike(like),
            PosDevice.brand.ilike(like),
        ))
    if status:
        stmt = stmt.where(PosDevice.status == status)
    if store:
        stmt = stmt.where(PosDevice.store_name == store)
    if brand:
        stmt = stmt.where(PosDevice.brand == brand)
    return stmt


def list_pos(db: Session, *, q, status, store, brand, sort, order, page, page_size):
    stmt = build_query(q, status, store, brand)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    col = SORTABLE.get(sort, PosDevice.hostname)
    stmt = stmt.order_by(desc(col) if order == "desc" else asc(col), PosDevice.id)
    items = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return items, total


def get_by_hostname(db: Session, hostname: str) -> PosDevice | None:
    return db.scalar(select(PosDevice).where(func.lower(PosDevice.hostname) == hostname.lower()))


def create_pos(db: Session, data: PosCreate) -> PosDevice:
    pos = PosDevice(**data.model_dump())
    db.add(pos)
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise DuplicatePosError("A POS with this hostname or IP address already exists") from e
    return pos


def update_pos(db: Session, pos: PosDevice, data: PosUpdate) -> dict:
    changes = {}
    for field, value in data.model_dump(exclude_unset=True).items():
        old = getattr(pos, field)
        old_s = None if old is None else str(old).split("/")[0]
        if old_s != (None if value is None else str(value)):
            changes[field] = {"from": old_s, "to": value}
            setattr(pos, field, value)
    try:
        db.flush()
    except IntegrityError as e:
        db.rollback()
        raise DuplicatePosError("A POS with this hostname or IP address already exists") from e
    return changes


def import_csv(db: Session, content: bytes, *, update_existing: bool) -> dict:
    created = updated = skipped = 0
    errors: list[str] = []
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return {"created": 0, "updated": 0, "skipped": 0, "errors": ["File must be UTF-8 encoded CSV"]}
    reader = csv.DictReader(io.StringIO(text))
    missing = {"hostname", "ip_address", "store_name"} - set(reader.fieldnames or [])
    if missing:
        return {"created": 0, "updated": 0, "skipped": 0, "errors": [f"Missing columns: {', '.join(sorted(missing))}"]}
    for line_no, row in enumerate(reader, start=2):
        row = {k: (v or "").strip() or None for k, v in row.items() if k in CSV_FIELDS}
        try:
            data = PosCreate(**row)
        except ValidationError as e:
            errors.append(f"Line {line_no}: {e.errors()[0]['loc'][0]} - {e.errors()[0]['msg']}")
            continue
        existing = get_by_hostname(db, data.hostname)
        try:
            with db.begin_nested():
                if existing:
                    if not update_existing:
                        skipped += 1
                        continue
                    for k, v in data.model_dump(exclude={"status"}).items():
                        setattr(existing, k, v)
                    updated += 1
                else:
                    db.add(PosDevice(**data.model_dump()))
                    created += 1
                db.flush()
        except IntegrityError:
            errors.append(f"Line {line_no}: duplicate hostname or IP ({data.hostname} / {data.ip_address})")
            if existing:
                updated -= 1
            else:
                created -= 1
        if len(errors) > 200:
            errors.append("Too many errors - import stopped")
            break
    return {"created": created, "updated": updated, "skipped": skipped, "errors": errors}


def _csv_safe(value) -> str:
    """Neutralise spreadsheet formula injection."""
    s = "" if value is None else str(value)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s


def export_csv(rows) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_FIELDS + ["status", "last_seen"])
    for p in rows:
        w.writerow([_csv_safe(str(p.ip_address).split("/")[0] if f == "ip_address" else getattr(p, f)) for f in CSV_FIELDS]
                   + [p.status, p.last_seen.isoformat() if p.last_seen else ""])
    return buf.getvalue()
