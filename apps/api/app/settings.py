"""Application settings loaded from environment variables."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── App ───────────────────────────────────────────
    env: str = "development"
    app_url: str = "http://localhost:5173"
    api_url: str = "http://localhost:8000"

    # Comma-separated list of allowed CORS origins. If empty, falls back to
    # [app_url, http://localhost:5173, http://localhost:5174] in main.py.
    # Example: "https://nova-fora-web.vamj8y.easypanel.host,http://localhost:5173"
    cors_origins: str = ""

    # ── Database ──────────────────────────────────────
    database_url: str = "postgresql+asyncpg://nova:dev_pass@localhost:5432/nova"

    # ── Redis ─────────────────────────────────────────
    redis_url: str = "redis://localhost:6379"

    # ── Auth ──────────────────────────────────────────
    jwt_secret: str = "dev_secret_change_in_prod"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    jwt_refresh_token_expire_days: int = 30

    # ── Storage (S3 compatible) ───────────────────────
    # Internal endpoint — used by the API for bucket mgmt + health checks.
    # In prod (EasyPanel Docker Swarm): http://nova-fora_storage:9000
    s3_endpoint: str = "http://localhost:9000"

    # Public endpoint — presigned URLs sign with THIS host so the browser can
    # upload directly. Must resolve from the public internet (HTTPS in prod).
    # In prod: https://nova-fora-storage.vamj8y.easypanel.host
    s3_public_endpoint: str = "http://localhost:9000"

    s3_bucket: str = "nova-fora-photos"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_region: str = "us-east-1"  # MinIO ignores, but boto3 requires a value
    s3_presign_ttl_seconds: int = 900  # 15 min upload window
    # Photo upload hard cap (bytes). Phone JPEGs are ~3-5 MB; we cap at
    # 10 MB to keep one accidental high-res burst from filling the
    # bucket. Enforced at three layers: client-side pre-check (friendly
    # error), presign signs ContentLength so MinIO 403s mismatched
    # bodies, and PhotoCommitRequest.size_bytes refuses oversized
    # records. Pilot P0 #6 minimum subset (2026-06-01).
    max_photo_bytes: int = 10 * 1024 * 1024

    # ── SMTP ──────────────────────────────────────────
    # When smtp_host is empty, the email service falls back to logging the
    # message to stdout so dev/local envs work without credentials. Configure
    # all four fields in prod (Gmail app password, SendGrid, AWS SES, etc.).
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "Nova Fora <noreply@example.com>"
    smtp_use_tls: bool = True

    # ── Gmail API (preferred transport) ───────────────
    # OAuth 2.0 client (Google Cloud, consent screen = Internal) plus the
    # refresh token of the sender mailbox, scope gmail.send. When all four
    # are set, every email goes through the Gmail API; otherwise SMTP; else
    # log. GMAIL_SENDER is the authorized mailbox (jescalona@dantzigfleets.com
    # for the marketplace test).
    gmail_client_id: str = ""
    gmail_client_secret: str = ""
    gmail_refresh_token: str = ""
    gmail_sender: str = ""

    # ── Invitations ───────────────────────────────────
    # Days until an invitation token expires. Re-send to bump the timer.
    invitation_ttl_days: int = 7

    # ── DFS CMR repair marketplace ────────────────────
    # Marketplace mail goes out through the email service (Gmail API, else
    # SMTP). MARKETPLACE_FROM_EMAIL must be the sending mailbox (or a verified
    # send-as alias) or Gmail rewrites/rejects it. Empty → GMAIL_SENDER, else
    # the address in SMTP_FROM.
    marketplace_from_email: str = ""
    marketplace_from_name: str = "DFS Repair Marketplace"
    # Reply-To on shop-facing mail (digest, decision notices). Empty → the
    # from address.
    marketplace_reply_to: str = ""
    # DFS coordination fee on each approved quote (spec §6).
    marketplace_fee_rate: float = 0.10
    # Only defects reported in the last N days are turned into offers. Keeps
    # the first run from offering the whole historical backlog.
    marketplace_lookback_days: int = 14
    # A physical defect (same van/part/position/type) awarded less than N
    # days ago is not re-offered when the next nightly inspection reports it
    # again — the shop is presumably still repairing it.
    marketplace_reoffer_after_days: int = 30
    # HMAC secret for DSP review links and prospect magic links. Empty →
    # JWT_SECRET is used. Rotating it invalidates every outstanding link.
    marketplace_token_secret: str = ""
    # Prospect magic links expire after N days; the next digest re-issues.
    marketplace_prospect_link_ttl_days: int = 30
    # Version stamped on a shop's acceptance of the DFS Repair Partner terms.
    marketplace_terms_version: str = "2026-11-04"
    marketplace_terms_url: str = ""
    # Inviter recorded on invitations created for prospects at their first
    # quote (invitations.invited_by_id is NOT NULL). Empty → first active
    # site_admin.
    marketplace_system_user_email: str = ""
    # Claude writes the opening paragraph of the daily digest.
    anthropic_api_key: str = ""
    marketplace_digest_model: str = "claude-opus-5-5"
    marketplace_digest_timeout_seconds: float = 30.0

    # ── Observability ─────────────────────────────────
    sentry_dsn: str = ""
    posthog_key: str = ""

    # ── Boot behavior ────────────────────────────────
    # Skip the defect catalog + DVIC template re-sync on startup. Default
    # is False (auto-seed on every boot — idempotent self-healing). Set
    # SKIP_BOOT_SEED=1 in env when running the CLI in a debug shell or
    # when you need a fast container start.
    skip_boot_seed: bool = False


@lru_cache
def get_settings() -> Settings:
    """Cached accessor — settings are read once per process."""
    return Settings()
