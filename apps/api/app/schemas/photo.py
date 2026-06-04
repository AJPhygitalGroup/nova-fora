"""Photo schemas — upload flow + responses."""
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

from app.models.photo import Photo, PhotoCategory
from app.settings import get_settings

_MAX_PHOTO_BYTES = get_settings().max_photo_bytes


# ─────────────────────────────────────────────────────
# Presigned upload flow
# ─────────────────────────────────────────────────────
class UploadKind(str, Enum):
    """Which entity the photo / file will be attached to."""

    INSPECTION = "inspection"
    DEFECT = "defect"
    WORK_ORDER = "work_order"
    # 2026-06-03 Jorge — body repair PAVE PDF upload. Path scoped to
    # body_repair_requests/<id>/pave/<bag>.pdf in MinIO.
    BODY_REPAIR_PAVE = "body_repair_pave"


class PresignedUploadRequest(BaseModel):
    """POST /uploads/presigned body."""

    kind: UploadKind
    # Parent id in frontend format (INS-XXXXX, FD-XXX, WO-XXXXX) OR raw int
    parent_id: str
    # Original filename (we sanitize; never trust)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(pattern=r"^image/(jpeg|png|webp|heic|heif)$")
    # The client MUST declare the file size up-front so we can sign
    # ContentLength into the URL (see storage/s3.generate_upload_url).
    # MinIO then 403s any PUT whose Content-Length doesn't match this
    # exact value — closes the "lie about size, dump GBs" hole.
    # Capped at settings.max_photo_bytes (default 10 MB).
    size_bytes: int = Field(ge=1, le=_MAX_PHOTO_BYTES)

    model_config = ConfigDict(extra="forbid")


class PresignedUploadResponse(BaseModel):
    upload_url: str
    storage_key: str
    expires_in: int  # seconds


# ─────────────────────────────────────────────────────
# Commit + list + response
# ─────────────────────────────────────────────────────
class PhotoCommitRequest(BaseModel):
    """POST /defects/{id}/photos (and inspection / WO variants).

    Called by the client AFTER the upload to MinIO succeeded. The storage_key
    must match one just minted by /uploads/presigned (we validate prefix +
    that the object actually exists in the bucket).
    """

    storage_key: str = Field(min_length=1, max_length=500)
    content_type: str = Field(pattern=r"^image/(jpeg|png|webp|heic|heif)$")
    size_bytes: int = Field(ge=1, le=_MAX_PHOTO_BYTES)  # 10 MB hard cap (was 50, now uniform w/ presign)
    category: PhotoCategory = PhotoCategory.DAMAGE
    width: int | None = Field(default=None, ge=1, le=10000)
    height: int | None = Field(default=None, ge=1, le=10000)

    model_config = ConfigDict(extra="forbid")


class PhotoResponse(BaseModel):
    id: str                  # PH-0001
    category: PhotoCategory
    url: str                 # presigned GET, ~1h TTL
    content_type: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    uploaded_by: str | None = None  # user full_name
    uploaded_at: datetime

    # Parent refs (only one set, but surfacing all three makes flat lists simpler)
    inspection_id: str | None = None
    defect_id: str | None = None
    work_order_id: str | None = None

    model_config = ConfigDict(from_attributes=True)


class PhotoListResponse(BaseModel):
    items: list[PhotoResponse]
    total: int
