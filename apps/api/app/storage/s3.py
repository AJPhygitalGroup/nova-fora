"""S3 / MinIO storage service.

Two clients, one bucket:
  - `_internal_client`: used for bucket lifecycle (create, CORS, policies).
    Points at the in-network endpoint — no public DNS/SSL overhead.
  - `_public_client`: used to mint presigned URLs. Signs with the public
    hostname so the browser can PUT/GET without proxying through our API.

Presigned URL lifecycle:
  1. Browser → POST /uploads/presigned → returns { upload_url, storage_key }
  2. Browser → PUT upload_url with the file bytes (direct to MinIO)
  3. Browser → POST /defects/{id}/photos { storage_key, ... } → metadata row
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from functools import lru_cache

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.settings import get_settings

log = logging.getLogger("nova.storage")
settings = get_settings()


# ─────────────────────────────────────────────────────
# Clients
# ─────────────────────────────────────────────────────
def _make_client(endpoint_url: str):
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key,
        region_name=settings.s3_region,
        # MinIO requires path-style addressing (not virtual-hosted style).
        # Presigned URLs inherit this.
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


@lru_cache
def _internal_client():
    return _make_client(settings.s3_endpoint)


@lru_cache
def _public_client():
    return _make_client(settings.s3_public_endpoint)


# ─────────────────────────────────────────────────────
# Bucket setup (idempotent)
# ─────────────────────────────────────────────────────
_CORS_ALLOWED_ORIGINS: list[str] = [
    o.strip()
    for o in settings.cors_origins.split(",")
    if o.strip()
] or [
    settings.app_url,
    "http://localhost:5173",
    "http://localhost:5174",
]


def ensure_bucket() -> None:
    """Create the bucket if missing.

    NOTE on CORS: modern MinIO (RELEASE.2024+ and all S3 providers) do NOT
    support the S3 PutBucketCors API. CORS is configured at server boot via
    the MINIO_API_CORS_ALLOW_ORIGIN environment variable (see MinIO service
    env in EasyPanel). For AWS S3, use the AWS console or terraform.

    Called at app startup. Safe to run multiple times — all ops are idempotent.
    """
    cli = _internal_client()
    bucket = settings.s3_bucket

    try:
        cli.head_bucket(Bucket=bucket)
        log.info("[storage] bucket %s already exists", bucket)
        return
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        if code not in ("404", "NoSuchBucket", "NotFound"):
            log.warning("[storage] head_bucket unexpected error: %s", e)
            raise

    cli.create_bucket(Bucket=bucket)
    log.info("[storage] created bucket %s", bucket)


# ─────────────────────────────────────────────────────
# Keys
# ─────────────────────────────────────────────────────
def new_storage_key(
    parent_kind: str, parent_id: int | str, original_filename: str
) -> str:
    """Generate a unique, date-sharded storage key.

    Example: photos/defects/FD-008/2026-04-24/0c72f8e4.jpg
    """
    now = datetime.now(timezone.utc)
    safe_ext = original_filename.rsplit(".", 1)[-1].lower()[:5] if "." in original_filename else "bin"
    safe_ext = "".join(c for c in safe_ext if c.isalnum()) or "bin"
    uid = uuid.uuid4().hex[:12]
    return f"photos/{parent_kind}/{parent_id}/{now:%Y-%m-%d}/{uid}.{safe_ext}"


# ─────────────────────────────────────────────────────
# Presigned URLs
# ─────────────────────────────────────────────────────
def generate_upload_url(storage_key: str, content_type: str) -> tuple[str, int]:
    """Return (presigned PUT URL, expires_in_seconds).

    The client PUTs the bytes directly to this URL; MinIO verifies the
    signature and content_type match before accepting.
    """
    cli = _public_client()
    ttl = settings.s3_presign_ttl_seconds
    url = cli.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": storage_key,
            "ContentType": content_type,
        },
        ExpiresIn=ttl,
    )
    return url, ttl


def generate_download_url(storage_key: str, ttl: int | None = None) -> str:
    """Presigned GET URL for the browser to render an <img> tag."""
    cli = _public_client()
    return cli.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket, "Key": storage_key},
        ExpiresIn=ttl or settings.s3_presign_ttl_seconds * 4,  # default 1h for reads
    )


def delete_object(storage_key: str) -> None:
    """Permanent delete from the bucket. Use soft-delete (is_deleted=true) first."""
    cli = _internal_client()
    try:
        cli.delete_object(Bucket=settings.s3_bucket, Key=storage_key)
    except ClientError as e:
        log.warning("[storage] delete_object failed for %s: %s", storage_key, e)
