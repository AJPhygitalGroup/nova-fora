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
    s3_endpoint: str = "http://localhost:9000"
    s3_bucket: str = "nova-dev"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_public_url: str = "http://localhost:9000/nova-dev"

    # ── SMTP ──────────────────────────────────────────
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = "Nova Fora <noreply@example.com>"

    # ── Observability ─────────────────────────────────
    sentry_dsn: str = ""
    posthog_key: str = ""


@lru_cache
def get_settings() -> Settings:
    """Cached accessor — settings are read once per process."""
    return Settings()
