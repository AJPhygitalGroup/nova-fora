"""Photo schemas — upload flow + responses."""
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.photo import Photo, PhotoCategory
from app.settings import get_settings

_MAX_PHOTO_BYTES = get_settings().max_photo_bytes
# Body repair PAVE PDFs are bigger than photos — typical PAVE is ~2MB
# but the rare full-fleet snapshot reaches ~20MB. 25MB ceiling matches
# the frontend file picker cap.
_MAX_PAVE_BYTES = 25 * 1024 * 1024


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
    # 2026-06-05 Jorge — PAVE-first flow. Customer uploads + parses
    # the PDF BEFORE the request is created (the parsed VIN drives
    # the vehicle picker, the damages drive the parts picker). No
    # parent required; the PDF lives under a "previews/" prefix and
    # gets re-referenced by storage_key when the real request is
    # created. Tenancy is just "authenticated user only" since the
    # preview leaves no DB trace.
    BODY_REPAIR_PAVE_PREVIEW = "body_repair_pave_preview"


class PresignedUploadRequest(BaseModel):
    """POST /uploads/presigned body.

    content_type + size_bytes are validated per-kind in a model_validator
    so the photo kinds keep their strict image-only contract while the
    body-repair PAVE kind only accepts PDFs (and gets a larger size cap).
    """

    kind: UploadKind
    # Parent id in frontend format (INS-XXXXX, FD-XXX, WO-XXXXX) OR raw int
    parent_id: str
    # Original filename (we sanitize; never trust)
    filename: str = Field(min_length=1, max_length=255)
    # Format-only check; per-kind allow-list lives in the model_validator
    # below (Pydantic field validators can't see other fields).
    content_type: str = Field(min_length=1, max_length=80)
    # Format-only check; per-kind size cap is in the model_validator.
    size_bytes: int = Field(ge=1, le=_MAX_PAVE_BYTES)

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _validate_kind_contract(self) -> "PresignedUploadRequest":
        """Per-kind content_type + size_bytes contract.

        - body_repair_pave → PDF only, up to 25 MB
        - everything else  → image/{jpeg,png,webp,heic,heif} only,
                             up to settings.max_photo_bytes (10 MB default)
        """
        if self.kind in (UploadKind.BODY_REPAIR_PAVE, UploadKind.BODY_REPAIR_PAVE_PREVIEW):
            if self.content_type.lower() != "application/pdf":
                raise ValueError(
                    "content_type must be application/pdf for body_repair_pave* uploads"
                )
            if self.size_bytes > _MAX_PAVE_BYTES:
                raise ValueError(
                    f"size_bytes exceeds PAVE PDF cap ({_MAX_PAVE_BYTES} bytes)"
                )
        else:
            import re
            if not re.fullmatch(r"image/(jpeg|png|webp|heic|heif)", self.content_type):
                raise ValueError(
                    "content_type must be image/{jpeg,png,webp,heic,heif} for photo kinds"
                )
            if self.size_bytes > _MAX_PHOTO_BYTES:
                raise ValueError(
                    f"size_bytes exceeds photo cap ({_MAX_PHOTO_BYTES} bytes)"
                )
        return self


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
