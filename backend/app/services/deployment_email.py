from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from html import escape

DEFAULT_NOTIFICATION_CC = "northafrica.support@alshaya.com"
SUCCESS_STATES = {"success", "successful", "succeeded", "completed"}


@dataclass(frozen=True, slots=True)
class DeploymentEmailDetails:
    store_name: str
    brand: str
    pos_hostname: str
    pos_ip: str | None
    pos_mac: str | None
    xml_filename: str
    deployed_at: datetime

    def normalized(self) -> "DeploymentEmailDetails":
        deployed_at = self.deployed_at
        if deployed_at.tzinfo is None:
            deployed_at = deployed_at.replace(tzinfo=timezone.utc)
        return DeploymentEmailDetails(
            store_name=self.store_name.strip(),
            brand=self.brand.strip(),
            pos_hostname=self.pos_hostname.strip(),
            pos_ip=(self.pos_ip or "Not available").strip(),
            pos_mac=(self.pos_mac or "Not available").strip(),
            xml_filename=self.xml_filename.strip(),
            deployed_at=deployed_at,
        )


@dataclass(frozen=True, slots=True)
class DeploymentEmailPreview:
    ready: bool
    to: list[str]
    cc: list[str]
    subject: str
    body_text: str
    body_html: str
    warning: str | None
    store_id: int | None
    configuration_url: str | None
    details: dict


def _date_label(value: datetime) -> str:
    return value.astimezone().strftime("%d %b %Y, %H:%M %Z")


def build_subject(details: DeploymentEmailDetails) -> str:
    value = details.normalized()
    return f"Visa Payment Configuration Updated – {value.store_name} – {value.pos_hostname}"


def build_text_body(details: DeploymentEmailDetails) -> str:
    value = details.normalized()
    return f"""Dear Store Team,

Please be informed that the Visa payment configuration has been successfully updated on the following POS terminal:

Deployment Details:
- Store Name: {value.store_name}
- Brand: {value.brand}
- POS Hostname: {value.pos_hostname}
- POS IP Address: {value.pos_ip}
- POS MAC Address: {value.pos_mac}
- Configuration File: {value.xml_filename}
- Deployment Status: Successfully Completed
- Deployment Date & Time: {_date_label(value.deployed_at)}

Required Action:
Kindly perform a test transaction to verify that the Visa payment integration is working correctly on the updated POS terminal.

If you experience any issues with Visa payment processing, please contact the IT Support team.

Best Regards,
Alshaya Retail IT Support
North Africa Support Team"""


def build_html_body(details: DeploymentEmailDetails, logo_url: str = "/alshaya-logo.png") -> str:
    value = details.normalized()
    rows = [
        ("Store Name", value.store_name),
        ("Brand", value.brand),
        ("POS Hostname", value.pos_hostname),
        ("POS IP Address", value.pos_ip or "Not available"),
        ("POS MAC Address", value.pos_mac or "Not available"),
        ("Configuration File", value.xml_filename),
        ("Deployment Status", "Successfully Completed"),
        ("Deployment Date & Time", _date_label(value.deployed_at)),
    ]
    row_html = "".join(
        '<tr><td style="padding:9px 12px;color:#5b6577;width:42%;border-bottom:1px solid #e8edf4;">'
        f"{escape(label)}</td><td style=\"padding:9px 12px;color:#172033;font-weight:600;border-bottom:1px solid #e8edf4;\">{escape(str(item))}</td></tr>"
        for label, item in rows
    )
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4f7fb;font-family:Segoe UI,Arial,sans-serif;color:#172033;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#fff;border:1px solid #dde5ef;border-radius:10px;overflow:hidden;">
<tr><td style="background:#0b1b3b;padding:24px 30px;"><img src="{escape(logo_url, quote=True)}" alt="Alshaya Group" width="170" style="display:block;max-width:170px;height:auto;"></td></tr>
<tr><td style="padding:30px;">
<p style="margin:0 0 18px;font-size:16px;">Dear Store Team,</p>
<p style="margin:0 0 22px;line-height:1.6;color:#3f4b5f;">Please be informed that the Visa payment configuration has been successfully updated on the following POS terminal:</p>
<div style="margin:0 0 22px;padding:11px 14px;border-left:4px solid #0aa77f;background:#ecfbf6;color:#08745a;font-weight:700;">✓ Deployment successfully completed</div>
<h2 style="font-size:17px;margin:0 0 10px;color:#0b1b3b;">Deployment Details</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e0e7f0;border-radius:7px;border-collapse:separate;border-spacing:0;">{row_html}</table>
<div style="margin:24px 0 0;padding:18px;background:#f6f9fd;border-radius:7px;">
<strong style="color:#0b1b3b;">Required Action</strong>
<p style="margin:8px 0 0;line-height:1.6;color:#3f4b5f;">Kindly perform a test transaction to verify that the Visa payment integration is working correctly on the updated POS terminal.</p>
</div>
<p style="margin:22px 0;line-height:1.6;color:#3f4b5f;">If you experience any issues with Visa payment processing, please contact the IT Support team.</p>
<p style="margin:0;line-height:1.6;">Best Regards,<br><strong>Alshaya Retail IT Support</strong><br>North Africa Support Team</p>
</td></tr>
<tr><td style="padding:16px 30px;background:#f7f9fc;border-top:1px solid #e5eaf1;color:#6b7484;font-size:12px;">Internal operational communication · Alshaya Group</td></tr>
</table></td></tr></table></body></html>"""


def build_preview(
    *,
    details: DeploymentEmailDetails,
    store_id: int | None,
    store_email: str | None,
    additional_recipients: list[str] | None = None,
    cc: list[str] | None = None,
    configuration_url: str | None = None,
    logo_url: str = "/alshaya-logo.png",
) -> DeploymentEmailPreview:
    recipients = [email.strip() for email in [store_email, *(additional_recipients or [])] if email and email.strip()]
    unique_recipients = list(dict.fromkeys(recipients))
    cc_values = list(dict.fromkeys(item.strip() for item in (cc or [DEFAULT_NOTIFICATION_CC]) if item.strip()))
    ready = bool(store_email and store_email.strip())
    warning = None if ready else "The associated store does not have a valid notification email. Configure the store email to enable Outlook and Copy actions."
    return DeploymentEmailPreview(
        ready=ready,
        to=unique_recipients,
        cc=cc_values,
        subject=build_subject(details),
        body_text=build_text_body(details),
        body_html=build_html_body(details, logo_url=logo_url),
        warning=warning,
        store_id=store_id,
        configuration_url=configuration_url,
        details=asdict(details.normalized()),
    )
