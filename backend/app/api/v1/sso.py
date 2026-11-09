"""Keycloak (OIDC) single sign-on.

Flow: Authorization Code + PKCE, confidential client.
  Browser -> /auth/sso/login -> Keycloak login page (FreeIPA users via LDAP federation)
          -> /auth/sso/callback -> code exchanged server-side -> user created/updated
          -> normal POS Control Center session cookie -> redirect to the app.

The ID token is received directly from Keycloak's token endpoint over a back-channel
request (never through the browser), so per OIDC Core 3.1.3.7 issuer/audience/expiry/nonce
are validated and TLS authenticates the issuer. No extra Python packages are required.
Roles come from Keycloak groups (FreeIPA groups synced into Keycloak).
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import ssl
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import client_ip, set_session_cookies
from app.core.config import settings
from app.core.redis_client import get_redis
from app.core.security import hash_password
from app.db.session import get_db
from app.models import User
from app.services import audit_service as audit

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth/sso", tags=["auth"])
STATE_COOKIE = "pcc_sso_state"
ROLE_ORDER = ("admin", "operator", "viewer")


class SsoError(Exception):
    pass


# ----------------------------------------------------------------- helpers
def _ssl_ctx() -> ssl.SSLContext:
    if settings.oidc_verify_tls:
        ctx = ssl.create_default_context()
        if settings.oidc_ca_file:
            ctx.load_verify_locations(settings.oidc_ca_file)
        return ctx
    return ssl._create_unverified_context()  # noqa: S323  (internal self-signed Keycloak)


def _http_json(url: str, data: dict | None = None) -> dict:
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"Accept": "application/json"})
    if body is not None:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=10, context=_ssl_ctx()) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SsoError(f"Keycloak returned HTTP {e.code}: {e.read()[:300].decode(errors='ignore')}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise SsoError(f"Cannot reach Keycloak: {e}") from e


_discovery: dict = {}


def _oidc_config() -> dict:
    if not _discovery or _discovery.get("_ts", 0) < time.time() - 3600:
        _discovery.clear()
        _discovery.update(_http_json(settings.oidc_issuer.rstrip("/") + "/.well-known/openid-configuration"))
        _discovery["_ts"] = time.time()
    return _discovery


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _decode_jwt_payload(token: str) -> dict:
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except Exception as e:  # noqa: BLE001
        raise SsoError("Malformed ID token") from e


def _redirect_uri(request: Request) -> str:
    if settings.oidc_redirect_uri:
        return settings.oidc_redirect_uri
    return str(request.url_for("sso_callback"))


def _groups(claims: dict) -> set[str]:
    raw = claims.get(settings.oidc_groups_claim) or []
    if isinstance(raw, str):
        raw = [raw]
    # Keycloak "full group path" gives /pos-admins ; normalise
    return {g.strip("/").split("/")[-1].lower() for g in raw if isinstance(g, str)}


def role_from_groups(groups: set[str]) -> str | None:
    mapping = {"admin": settings.oidc_admin_groups, "operator": settings.oidc_operator_groups,
               "viewer": settings.oidc_viewer_groups}
    for role in ROLE_ORDER:  # highest privilege wins
        if groups & {g.lower() for g in mapping[role]}:
            return role
    return settings.oidc_default_role or None


def _fail(msg: str) -> RedirectResponse:
    log.warning("SSO failed: %s", msg)
    return RedirectResponse("/login?sso_error=" + urllib.parse.quote(msg[:200]), status_code=303)


# ----------------------------------------------------------------- endpoints
@router.get("/config")
def sso_config():
    """Tells the login page whether to show the SSO button."""
    return {"enabled": settings.oidc_enabled, "label": settings.oidc_button_label,
            "local_login": settings.local_login_enabled}


@router.get("/login")
def sso_login(request: Request):
    if not settings.oidc_enabled:
        return _fail("SSO is not enabled")
    try:
        cfg = _oidc_config()
    except SsoError as e:
        return _fail(str(e))
    state, nonce, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    get_redis().set(f"sso:{state}", json.dumps({"nonce": nonce, "verifier": verifier}), ex=600)
    params = {
        "client_id": settings.oidc_client_id,
        "response_type": "code",
        "scope": settings.oidc_scopes,
        "redirect_uri": _redirect_uri(request),
        "state": state,
        "nonce": nonce,
        "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()),
        "code_challenge_method": "S256",
    }
    resp = RedirectResponse(cfg["authorization_endpoint"] + "?" + urllib.parse.urlencode(params), status_code=303)
    # Lax so it survives the top-level redirect back from Keycloak; binds the state to this browser
    resp.set_cookie(STATE_COOKIE, state, max_age=600, httponly=True, secure=settings.cookie_secure,
                    samesite="lax", path="/api/v1/auth/sso")
    return resp


@router.get("/callback", name="sso_callback")
def sso_callback(request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    q = request.query_params
    if q.get("error"):
        return _fail(f"Keycloak: {q.get('error_description') or q.get('error')}")
    state, code = q.get("state"), q.get("code")
    if not state or not code or request.cookies.get(STATE_COOKIE) != state:
        return _fail("Invalid or expired sign-in request. Please try again.")
    r = get_redis()
    raw = r.get(f"sso:{state}")
    r.delete(f"sso:{state}")
    if not raw:
        return _fail("Sign-in request expired. Please try again.")
    saved = json.loads(raw)

    try:
        cfg = _oidc_config()
        tokens = _http_json(cfg["token_endpoint"], {
            "grant_type": "authorization_code", "code": code, "redirect_uri": _redirect_uri(request),
            "client_id": settings.oidc_client_id, "client_secret": settings.oidc_client_secret,
            "code_verifier": saved["verifier"],
        })
        claims = _decode_jwt_payload(tokens["id_token"])
        aud = claims.get("aud")
        aud = aud if isinstance(aud, list) else [aud]
        if claims.get("iss") != cfg["issuer"]:
            raise SsoError("ID token issuer mismatch")
        if settings.oidc_client_id not in aud:
            raise SsoError("ID token audience mismatch")
        if claims.get("exp", 0) < time.time() - 60:
            raise SsoError("ID token expired")
        if claims.get("nonce") != saved["nonce"]:
            raise SsoError("ID token nonce mismatch")
    except (SsoError, KeyError) as e:
        return _fail(str(e) if isinstance(e, SsoError) else "Unexpected token response from Keycloak")

    username = (claims.get(settings.oidc_username_claim) or "").strip()
    email = (claims.get("email") or f"{username}@{settings.oidc_email_fallback_domain}").strip().lower()
    full_name = claims.get("name") or " ".join(filter(None, [claims.get("given_name"), claims.get("family_name")])) or None
    groups = _groups(claims)
    role = role_from_groups(groups)
    if not username:
        return _fail("Keycloak did not return a username")
    if not role:
        audit.record(db, audit.AuditAction.LOGIN_FAILED, username=username[:64], ip=ip,
                     details={"reason": "sso_no_group", "groups": sorted(groups)[:50]})
        db.commit()
        return _fail("Your account is not in any POS Control Center group. Ask an administrator for access.")

    user = db.scalar(select(User).where(or_(func.lower(User.username) == username.lower(),
                                            func.lower(User.email) == email)))
    created = user is None
    if created:
        user = User(username=username[:64], email=email[:255], full_name=(full_name or None),
                    role=role, password_hash=hash_password(secrets.token_urlsafe(48)))  # unusable local password
        db.add(user)
    else:
        if not user.is_active:
            audit.record(db, audit.AuditAction.LOGIN_FAILED, user=user, ip=ip, details={"reason": "inactive", "sso": True})
            db.commit()
            return _fail("Your POS Control Center account is disabled.")
        if settings.oidc_sync_role and user.role != role:
            user.role = role
            user.token_version += 1
        if full_name:
            user.full_name = full_name[:128]
    user.last_login_at = datetime.now(timezone.utc)
    db.flush()
    if created:
        audit.record(db, audit.AuditAction.USER_CREATED, username="sso", target=f"user {user.username}",
                     ip=ip, details={"role": role, "source": "keycloak", "groups": sorted(groups)[:50]})
    audit.record(db, audit.AuditAction.LOGIN_SUCCESS, user=user, ip=ip,
                 details={"method": "sso", "role": role})
    db.commit()

    resp = RedirectResponse("/", status_code=303)
    resp.delete_cookie(STATE_COOKIE, path="/api/v1/auth/sso")
    set_session_cookies(resp, user)
    return resp


@router.get("/logout-url")
def sso_logout_url():
    """Where the browser goes after local logout to also end the Keycloak session."""
    if not settings.oidc_enabled or not settings.oidc_post_logout_redirect_uri:
        return {"url": None}
    try:
        end = _oidc_config().get("end_session_endpoint")
    except SsoError:
        return {"url": None}
    if not end:
        return {"url": None}
    return {"url": end + "?" + urllib.parse.urlencode({
        "client_id": settings.oidc_client_id,
        "post_logout_redirect_uri": settings.oidc_post_logout_redirect_uri})}
