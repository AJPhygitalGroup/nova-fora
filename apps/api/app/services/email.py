"""Email service — Gmail API, then SMTP, then log fallback.

Three modes, picked at call time so a single binary works dev → prod:

  - **Gmail** — when all four GMAIL_* settings are set (OAuth 2.0 client +
                refresh token of the sender mailbox, scope `gmail.send`), the
                MIME message is sent RAW through `users.messages.send`, so
                the From display name and Reply-To headers survive. The
                consent screen must be Internal (Workspace) — in External
                "Testing" mode Google expires the refresh token after 7 days.
  - **SMTP**  — when `settings.smtp_host` is non-empty, send a real email via
                `smtplib`. STARTTLS by default; turn off via `smtp_use_tls=false`
                if the relay does implicit TLS or none.
  - **Log**   — when SMTP isn't configured, write the message to stdout. The
                invite link is included verbatim so an admin can copy it from
                container logs (or from the `last_email_sent_at` UI surface)
                while we wait for SMTP creds.

The service is intentionally synchronous + fire-and-forget: routes call it
inside the request, and any failure logs (doesn't raise) so a flaky SMTP
relay never blocks an invitation from being created. Re-send is the recovery
path, exposed via POST /auth/invitations/{id}/resend.
"""
from __future__ import annotations

import base64
import logging
import smtplib
import threading
import time
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr, parseaddr

import httpx

from app.settings import get_settings

log = logging.getLogger(__name__)


@dataclass
class EmailMessage:
    to: str
    subject: str
    text: str          # plain-text fallback
    html: str          # HTML body
    # Optional overrides — all default to None so existing callers
    # (invitations) keep the exact SMTP_FROM header they had before.
    #   from_name    display name, e.g. "Chemas Autohaus via DFS"
    #   from_address envelope/header address; defaults to SMTP_FROM's address
    #   reply_to     Reply-To header (e.g. the shop's chosen email)
    from_name: str | None = None
    from_address: str | None = None
    reply_to: str | None = None


def resolve_sender(msg: EmailMessage, default_sender: str) -> str:
    """The `From` header for `msg`.

    No overrides → `default_sender` verbatim (SMTP_FROM, unchanged
    behavior). With a display name and/or address override, the address
    falls back to the one inside SMTP_FROM so Gmail / Workspace still sees
    the authenticated mailbox.
    """
    if not msg.from_name and not msg.from_address:
        return default_sender
    default_name, default_addr = parseaddr(default_sender)
    address = msg.from_address or default_addr
    name = msg.from_name if msg.from_name is not None else default_name
    if not name:
        return address
    # formataddr quotes the name and RFC 2047-encodes non-ASCII (accents).
    return formataddr((name, address))


def _build_mime(msg: EmailMessage, sender: str) -> MIMEMultipart:
    mime = MIMEMultipart("alternative")
    mime["Subject"] = msg.subject
    mime["From"] = resolve_sender(msg, sender)
    mime["To"] = msg.to
    if msg.reply_to:
        mime["Reply-To"] = msg.reply_to
    mime.attach(MIMEText(msg.text, "plain", "utf-8"))
    mime.attach(MIMEText(msg.html, "html", "utf-8"))
    return mime


def _send_via_smtp(msg: EmailMessage) -> bool:
    s = get_settings()
    try:
        mime = _build_mime(msg, s.smtp_from)
        if s.smtp_use_tls:
            client = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=15)
            client.starttls()
        else:
            client = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=15)
        try:
            if s.smtp_user:
                client.login(s.smtp_user, s.smtp_password)
            client.send_message(mime)
        finally:
            try:
                client.quit()
            except Exception:  # noqa: BLE001 — best-effort cleanup
                pass
        log.info("email sent via SMTP", extra={"to": msg.to, "subject": msg.subject})
        return True
    except Exception as exc:  # noqa: BLE001 — never raise into routes
        log.exception(
            "email send failed (fallback to log only)",
            extra={"to": msg.to, "subject": msg.subject, "error": str(exc)},
        )
        return False


def _log_message(msg: EmailMessage) -> None:
    """Dev fallback — print the email so admins can grab the invite link."""
    border = "─" * 72
    log.warning(
        "\n%s\n[email-stub] no Gmail API / SMTP configured — would send:\n"
        "  From:     %s\n  To:       %s\n  Reply-To: %s\n  Subject:  %s\n\n%s\n%s",
        border, resolve_sender(msg, get_settings().smtp_from), msg.to,
        msg.reply_to or "-", msg.subject, msg.text, border,
    )


# ─────────────────────────────────────────────────────────
# Gmail API transport (OAuth 2.0 refresh token → users.messages.send)
# ─────────────────────────────────────────────────────────
GMAIL_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"

_gmail_token_lock = threading.Lock()
_gmail_token: dict[str, float | str] = {}


def gmail_configured() -> bool:
    s = get_settings()
    return bool(
        s.gmail_client_id and s.gmail_client_secret and s.gmail_refresh_token and s.gmail_sender
    )


def _gmail_http() -> httpx.Client:
    """HTTP client factory — tests swap in an httpx.MockTransport."""
    return httpx.Client(timeout=15)


def _gmail_default_sender() -> str:
    """SMTP_FROM's display name on the authorized Gmail mailbox. Gmail only
    sends as the authenticated account (or its verified send-as aliases)."""
    s = get_settings()
    name, _ = parseaddr(s.smtp_from)
    return formataddr((name, s.gmail_sender)) if name else s.gmail_sender


def _gmail_access_token(client: httpx.Client) -> str:
    with _gmail_token_lock:
        token = _gmail_token.get("value")
        if token and float(_gmail_token.get("expires_at", 0)) - 60 > time.time():
            return str(token)
        s = get_settings()
        resp = client.post(
            GMAIL_TOKEN_URL,
            data={
                "client_id": s.gmail_client_id,
                "client_secret": s.gmail_client_secret,
                "refresh_token": s.gmail_refresh_token,
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        body = resp.json()
        _gmail_token["value"] = body["access_token"]
        _gmail_token["expires_at"] = time.time() + float(body.get("expires_in", 3600))
        return str(body["access_token"])


def _send_via_gmail(msg: EmailMessage) -> bool:
    try:
        mime = _build_mime(msg, _gmail_default_sender())
        raw = base64.urlsafe_b64encode(mime.as_bytes()).decode("ascii")
        with _gmail_http() as client:
            token = _gmail_access_token(client)
            resp = client.post(
                GMAIL_SEND_URL,
                headers={"Authorization": f"Bearer {token}"},
                json={"raw": raw},
            )
            if resp.status_code == 401:  # token revoked / rotated → refresh once
                _gmail_token.clear()
                token = _gmail_access_token(client)
                resp = client.post(
                    GMAIL_SEND_URL,
                    headers={"Authorization": f"Bearer {token}"},
                    json={"raw": raw},
                )
            resp.raise_for_status()
        log.info("email sent via Gmail API", extra={"to": msg.to, "subject": msg.subject})
        return True
    except Exception as exc:  # noqa: BLE001 — never raise into routes
        log.exception(
            "Gmail API send failed",
            extra={"to": msg.to, "subject": msg.subject, "error": str(exc)},
        )
        return False


def send(msg: EmailMessage) -> bool:
    """Gmail API if configured, else SMTP if configured, else log.

    Returns True iff a real transport accepted the message.
    """
    s = get_settings()
    if gmail_configured():
        return _send_via_gmail(msg)
    if s.smtp_host:
        return _send_via_smtp(msg)
    _log_message(msg)
    return False  # log doesn't count as a real delivery


# ─────────────────────────────────────────────────────────
# Invitation-specific helper
# ─────────────────────────────────────────────────────────
# Bilingual invitation templates. The caller picks `lang` based on the
# invitee's preferred language (falls back to the inviter's org default
# or "es-MX" for the Nova Fora Mexico market). Adding a new language is
# a matter of extending these two dicts.
_INVITATION_COPY: dict[str, dict[str, str]] = {
    "en": {
        "greeting_named": "Hi {name},",
        "greeting_anon": "Hi,",
        "body_intro": (
            "{inviter} has invited you to join {org} on Nova Fora as a {role}."
        ),
        "body_cta_text": (
            "Click the link below to accept and finish setting up your account:"
        ),
        "body_expiry": (
            "This link expires in {days} days. If you weren't expecting "
            "this invitation you can ignore this email."
        ),
        "signoff": "— Nova Fora",
        "subject": "{inviter} invited you to {org} on Nova Fora",
        "html_heading": "You're invited to Nova Fora",
        "html_intro": (
            "<strong>{inviter}</strong> invited you to join "
            "<strong>{org}</strong> as a <strong>{role}</strong>."
        ),
        "html_cta": "Accept invitation",
        "html_paste_url": "Or paste this URL into your browser:",
        "html_expiry": (
            "This link expires in {days} days. If you weren't expecting this "
            "invitation you can ignore this email."
        ),
    },
    "es": {
        "greeting_named": "Hola {name},",
        "greeting_anon": "Hola,",
        "body_intro": (
            "{inviter} te ha invitado a unirte a {org} en Nova Fora como {role}."
        ),
        "body_cta_text": (
            "Haz clic en el enlace de abajo para aceptar y terminar de configurar tu cuenta:"
        ),
        "body_expiry": (
            "Este enlace expira en {days} días. Si no esperabas esta "
            "invitación, puedes ignorar este correo."
        ),
        "signoff": "— Nova Fora",
        "subject": "{inviter} te invitó a {org} en Nova Fora",
        "html_heading": "Te invitaron a Nova Fora",
        "html_intro": (
            "<strong>{inviter}</strong> te invitó a unirte a "
            "<strong>{org}</strong> como <strong>{role}</strong>."
        ),
        "html_cta": "Aceptar invitación",
        "html_paste_url": "O pega esta URL en tu navegador:",
        "html_expiry": (
            "Este enlace expira en {days} días. Si no esperabas esta "
            "invitación, puedes ignorar este correo."
        ),
    },
}


def _copy(lang: str) -> dict[str, str]:
    """Pick the copy bundle for `lang`, falling back to English."""
    base = (lang or "en").lower().split("-", 1)[0]
    return _INVITATION_COPY.get(base) or _INVITATION_COPY["en"]


def render_invitation_email(
    *,
    invitee_name: str | None,
    inviter_name: str,
    org_label: str,
    role_label: str,
    accept_url: str,
    expires_in_days: int,
    lang: str = "en",
) -> EmailMessage:
    c = _copy(lang)
    greeting = (
        c["greeting_named"].format(name=invitee_name)
        if invitee_name
        else c["greeting_anon"]
    )
    text = (
        f"{greeting}\n\n"
        f"{c['body_intro'].format(inviter=inviter_name, org=org_label, role=role_label)}\n\n"
        f"{c['body_cta_text']}\n"
        f"{accept_url}\n\n"
        f"{c['body_expiry'].format(days=expires_in_days)}\n\n"
        f"{c['signoff']}"
    )
    html_intro = c["html_intro"].format(
        inviter=inviter_name, org=org_label, role=role_label
    )
    html_expiry = c["html_expiry"].format(days=expires_in_days)
    html = f"""<!doctype html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
                   color:#1f2937; max-width:560px; margin:32px auto; padding:0 16px;">
  <h2 style="color:#0f172a; margin:0 0 8px;">{c['html_heading']}</h2>
  <p style="margin:0 0 16px;">{html_intro}</p>
  <p style="margin:24px 0;">
    <a href="{accept_url}"
       style="display:inline-block; background:#2563eb; color:#fff; text-decoration:none;
              padding:12px 20px; border-radius:8px; font-weight:600;">
      {c['html_cta']}
    </a>
  </p>
  <p style="font-size:13px; color:#475569; margin:24px 0 8px;">
    {c['html_paste_url']}<br>
    <code style="word-break:break-all;">{accept_url}</code>
  </p>
  <p style="font-size:12px; color:#64748b; margin-top:32px;">
    {html_expiry}
  </p>
</body></html>"""
    return EmailMessage(
        to="",  # caller fills
        subject=c["subject"].format(inviter=inviter_name, org=org_label),
        text=text,
        html=html,
    )
