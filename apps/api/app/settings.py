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

    # ── Invitations ───────────────────────────────────
    # Days until an invitation token expires. Re-send to bump the timer.
    invitation_ttl_days: int = 7

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
