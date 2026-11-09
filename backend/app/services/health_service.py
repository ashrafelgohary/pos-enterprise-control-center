"""Lightweight POS reachability check (TCP connect to SSH port; no root/ICMP needed).
If you already run Prometheus Blackbox for POS, this can be disabled (HEALTH_CHECK_ENABLED=false)
and status fed from your monitoring instead."""
from __future__ import annotations

import socket
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from sqlalchemy import select, update

from app.core.config import settings
from app.db.session import session_scope
from app.models import PosDevice


def _probe(ip: str) -> bool:
    try:
        with socket.create_connection((ip, settings.health_check_port), timeout=settings.health_check_timeout_seconds):
            return True
    except OSError:
        return False


def run_health_checks() -> dict:
    with session_scope() as db:
        rows = db.execute(select(PosDevice.id, PosDevice.ip_address).where(PosDevice.status != "maintenance")).all()
    targets = [(i, str(ip).split("/")[0]) for i, ip in rows]
    with ThreadPoolExecutor(max_workers=settings.health_check_workers) as pool:
        results = list(pool.map(lambda t: (t[0], _probe(t[1])), targets))
    now = datetime.now(timezone.utc)
    online = [i for i, ok in results if ok]
    offline = [i for i, ok in results if not ok]
    with session_scope() as db:
        if online:
            db.execute(update(PosDevice).where(PosDevice.id.in_(online), PosDevice.status != "maintenance")
                       .values(status="online", last_seen=now))
        if offline:
            db.execute(update(PosDevice).where(PosDevice.id.in_(offline), PosDevice.status != "maintenance")
                       .values(status="offline"))
    return {"online": len(online), "offline": len(offline)}
