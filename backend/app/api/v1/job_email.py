"""Job-level deployment email: ONE email per store per deployment job, listing every
POS of that store that was updated successfully in the job. Failed/cancelled POS are
never included. Response shape matches the existing DeploymentEmailPreview type."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from html import escape

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require
from app.core.rbac import Permission
from app.db.session import get_db
from app.models import XmlJob

router = APIRouter(prefix="/deployments", tags=["deployments"])
DEFAULT_CC = "northafrica.support@alshaya.com"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
NAVY, GREEN, GREEN_BG, TEXT, MUTED, BORDER = "#0b1730", "#08745a", "#ecfbf6", "#1e293b", "#64748b", "#e2e8f0"


def _emails(raw: str | None) -> list[str]:
    return [a for a in re.split(r"[;,\s]+", raw or "") if EMAIL_RE.match(a)]


def _when(dt: datetime | None) -> str:
    dt = dt or datetime.now(timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC")


def _subject(store: str, hosts: list[str]) -> str:
    tail = ", ".join(hosts) if len(hosts) <= 3 else f"{len(hosts)} POS Terminals"
    return f"Visa Payment Configuration Updated – {store} – {tail}"


def _text(store: str, brand: str, job_id: int, when: str, rows: list[dict]) -> str:
    n = len(rows)
    lines = [
        "Dear Store Team,", "",
        "Please be informed that the Visa payment configuration has been successfully updated on the following "
        + ("POS terminal:" if n == 1 else f"{n} POS terminals:"), "",
        "Deployment Details:",
        f"- Store Name: {store}", f"- Brand: {brand}", f"- Deployment Reference: Job #{job_id}",
        "- Deployment Status: Successfully Completed", f"- Deployment Date & Time: {when}", "",
        "POS Terminal" + ("" if n == 1 else "s") + ":",
    ]
    for i, r in enumerate(rows, 1):
        lines += [f"{i}. {r['hostname']} - Success"]
    lines += [
        "", "Required Action:",
        "Kindly perform a test transaction on " + ("the updated POS terminal" if n == 1 else "each of the updated POS terminals")
        + " to verify that the Visa payment integration is working correctly.", "",
        "If you experience any issues with Visa payment processing, please contact the IT Support team.", "",
        "Best Regards,", "Alshaya Retail IT Support", "North Africa Support Team",
    ]
    return "\n".join(lines)


def _html(store: str, brand: str, job_id: int, when: str, rows: list[dict]) -> str:
    n = len(rows)
    e = escape
    td = f"padding:9px 12px;border-bottom:1px solid {BORDER};font-size:13px;color:{TEXT};"
    th = f"padding:9px 12px;border-bottom:2px solid {BORDER};font-size:12px;color:{MUTED};text-align:left;font-weight:600;"
    kv = "".join(
        f'<tr><td style="{td}color:{MUTED};width:42%;">{e(k)}</td><td style="{td}font-weight:600;">{e(v)}</td></tr>'
        for k, v in [("Store Name", store), ("Brand", brand), ("Deployment Reference", f"Job #{job_id}"),
                     ("Deployment Status", "Successfully Completed"), ("Deployment Date & Time", when)])
    pos = "".join(
        f'<tr><td style="{td}font-weight:600;">{e(r["hostname"])}</td>'
        f'<td style="{td}color:{GREEN};font-weight:700;white-space:nowrap;">&#10003; Success</td></tr>' for r in rows)
    intro = "POS terminal:" if n == 1 else f"<b>{n}</b> POS terminals:"
    action = "the updated POS terminal" if n == 1 else "<b>each</b> of the updated POS terminals"
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6fa;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;background:#ffffff;border:1px solid {BORDER};font-family:'Segoe UI',Arial,sans-serif;">
<tr><td style="background:{NAVY};padding:22px 30px;"><img src="/alshaya-logo.png" alt="Alshaya Group" height="72" style="display:block;height:72px;border:0;"></td></tr>
<tr><td style="padding:28px 30px 8px;font-size:14px;line-height:1.6;color:{TEXT};">
<p style="margin:0 0 14px;">Dear Store Team,</p>
<p style="margin:0 0 18px;">Please be informed that the Visa payment configuration has been successfully updated on the following {intro}</p>
<div style="margin:0 0 22px;padding:11px 14px;border-left:4px solid #0aa77f;background:{GREEN_BG};color:{GREEN};font-weight:700;">&#10003; Deployment successfully completed</div>
<h2 style="font-size:16px;margin:0 0 8px;color:{NAVY};">Deployment Details</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid {BORDER};border-collapse:collapse;margin:0 0 22px;">{kv}</table>
<h2 style="font-size:16px;margin:0 0 8px;color:{NAVY};">Updated POS Terminal{'' if n == 1 else 's'}</h2>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid {BORDER};border-collapse:collapse;margin:0 0 22px;">
<tr><td style="{th}">Hostname</td><td style="{th}width:30%;">Status</td></tr>{pos}</table>
<h2 style="font-size:16px;margin:0 0 8px;color:{NAVY};">Required Action</h2>
<p style="margin:0 0 14px;">Kindly perform a test transaction on {action} to verify that the Visa payment integration is working correctly.</p>
<p style="margin:0 0 22px;">If you experience any issues with Visa payment processing, please contact the IT Support team.</p>
<p style="margin:0 0 26px;">Best Regards,<br><b>Alshaya Retail IT Support</b><br>North Africa Support Team</p>
</td></tr>
<tr><td style="padding:14px 30px;border-top:1px solid {BORDER};font-size:11px;color:{MUTED};">This notification was prepared by POS Control Center &middot; Alshaya Group &middot; Internal use only</td></tr>
</table></td></tr></table></body></html>"""


@router.get("/jobs/{job_id}/email-previews")
def job_email_previews(job_id: int, db: Session = Depends(get_db), _=Depends(require(Permission.JOBS_READ))):
    job = db.get(XmlJob, job_id)
    if not job:
        raise HTTPException(404, "Deployment not found.")
    ok = [r for r in job.results if r.status == "success"]
    if not ok:
        raise HTTPException(409, "No POS in this deployment completed successfully. Email notifications are only available after a successful deployment.")
    cc = _emails(db.execute(text("select value from application_settings where key='deployment_email_default_cc'")).scalar()
                 or DEFAULT_CC)

    groups: dict[int | None, list] = {}
    for r in sorted(ok, key=lambda r: r.hostname):
        store = r.pos.store if r.pos is not None else None
        groups.setdefault(store.id if store else None, []).append((r, store))

    out = []
    for store_id, items in groups.items():
        store = items[0][1]
        rows = [{"hostname": r.hostname, "ip": r.ip_address,
                 "mac": str(r.pos.mac_address) if r.pos is not None and r.pos.mac_address else "Not available",
                 "file": r.xml_filename} for r, _s in items]
        name = store.name if store else (items[0][0].pos.store_name if items[0][0].pos is not None else "Unassigned store")
        brand = (store.brand if store else None) or (items[0][0].pos.brand if items[0][0].pos is not None else None) or "Not available"
        when = _when(max((r.completed_at for r, _s in items if r.completed_at), default=None))
        to = (_emails(store.email) + _emails(store.additional_recipients)) if store else []
        warning = None
        if store is None:
            warning = "These POS terminals are not assigned to a store, so no store email address is available."
        elif not to:
            warning = f"The store '{store.name}' has no valid email address. Configure it before notifying the store."
        hosts = [x["hostname"] for x in rows]
        out.append({
            "ready": bool(to), "to": to, "cc": cc, "subject": _subject(name, hosts),
            "body_text": _text(name, brand, job_id, when, rows), "body_html": _html(name, brand, job_id, when, rows),
            "warning": warning, "store_id": store_id,
            "configuration_url": None if to else "/admin/stores",
            "details": {"Store Name": name, "Brand": brand, "POS Terminals": ", ".join(hosts),
                        "Deployment Reference": f"Job #{job_id}", "Deployment Date & Time": when},
            "store_name": name, "pos_ids": [r.pos_id for r, _s in items if r.pos_id], "pos_hostnames": hosts,
        })
    out.sort(key=lambda p: (not p["ready"], p["store_name"]))
    return out
