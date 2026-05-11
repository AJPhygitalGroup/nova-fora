"""Email service — SMTP when configured, log fallback when not.

Two modes, picked at call time so a single binary works dev → prod:

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

import logging
import smtplib
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.settings import get_settings

log = logging.getLogger(__name__)


@dataclass
class EmailMessage:
    to: str
    subject: str
    text: str          # plain-text fallback
    html: str          # HTML body


def _build_mime(msg: EmailMessage, sender: str) -> MIMEMultipart:
    mime = MIMEMultipart("alternative")
    mime["Subject"] = msg.subject
    mime["From"] = sender
    mime["To"] = msg.to
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
        "\n%s\n[email-stub] SMTP not configured — would send:\n"
        "  To:      %s\n  Subject: %s\n\n%s\n%s",
        border, msg.to, msg.subject, msg.text, border,
    )


def send(msg: EmailMessage) -> bool:
    """Try SMTP if configured, fall back to log. Returns True iff SMTP delivered."""
    s = get_settings()
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
