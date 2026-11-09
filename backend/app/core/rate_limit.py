"""Redis-backed limiter for authentication endpoints (fixed window + per-user lockout)."""
from __future__ import annotations

from app.core.config import settings
from app.core.redis_client import get_redis


def hit_ip(ip: str) -> bool:
    """Count a login attempt from an IP. Returns False when the limit is exceeded."""
    r = get_redis()
    key = f"rl:login:ip:{ip}"
    count = r.incr(key)
    if count == 1:
        r.expire(key, 60)
    return count <= settings.login_rate_limit_per_minute


def is_locked(username: str) -> bool:
    return int(get_redis().get(f"rl:login:fail:{username.lower()}") or 0) >= settings.login_max_failures


def register_failure(username: str) -> None:
    r = get_redis()
    key = f"rl:login:fail:{username.lower()}"
    count = r.incr(key)
    if count == 1:
        r.expire(key, settings.login_lockout_minutes * 60)


def reset_failures(username: str) -> None:
    get_redis().delete(f"rl:login:fail:{username.lower()}")
