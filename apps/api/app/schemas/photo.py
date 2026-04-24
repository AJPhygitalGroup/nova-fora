"""Photo schemas — upload flow + responses."""
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field

from app.models.photo import Photo, PhotoCategory


# ─────────────────────────────────────────────────────
# Presigned upload flow
# ─────────────────────────────────────────────────────
class UploadKind(str, Enum):
    """Which entity the photo will be attached to."""

    INSPECTION = "inspection"
    DEFECT = "defect"
    WORK_ORDER = "work_order"


class PresignedUploadRequest(BaseModel):
    """POST /uploads/presigned body."""

    kind: UploadKind
    # Parent id in frontend format (INS-XXXXX, FD-XXX, WO-XXXXX) OR raw int
    parent_id: str
    # Original filename (we sanitize; never trust)
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(pattern=r"^image/(jpeg|png|webp|heic|heif)$")

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
    size_bytes: int = Field(ge=1, le=50 * 1024 * 1024)  # 50 MB hard cap
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
