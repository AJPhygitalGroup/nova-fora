"""Photo model — metadata only. The binary file lives in MinIO/S3.

Design:
  - Polymorphic parent: a photo belongs to EXACTLY ONE of: inspection, defect,
    or work_order. Enforced by a CHECK constraint at the DB level.
  - `storage_key` is the path inside the bucket (e.g. "photos/2026/04/24/uuid.jpg").
    We NEVER store full URLs — bucket and domain can move without re-migrating.
  - URLs are generated at serialize-time as presigned (signed, expire in 1h) so
    the browser can fetch directly without proxying through the API.
  - `photo_count` on parent entities (defect, inspection) is updated by the
    service layer on insert/delete — keeps list queries fast (no COUNT aggregate).
"""
from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class PhotoCategory(str, Enum):
    """Drives UI rendering order (odometer always first, for example)."""

    ODOMETER = "odometer"       # Dashboard reading at start of inspection
    OVERVIEW = "overview"       # Wide shot of a section (front, sides, etc.)
    DAMAGE = "damage"           # Close-up of a specific defect
    QC_BEFORE = "qc_before"     # Before-repair photo (vendor workflow)
    QC_AFTER = "qc_after"       # After-repair photo
    OTHER = "other"


class Photo(SQLModel, table=True):
    __tablename__ = "photos"
    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN inspection_id IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN defect_id IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN work_order_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="photos_one_parent_check",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)

    # Polymorphic parent (exactly one is set, enforced by CHECK)
    inspection_id: int | None = Field(
        default=None, foreign_key="inspections.id", index=True
    )
    defect_id: int | None = Field(
        default=None, foreign_key="reported_defects.id", index=True
    )
    # work_order_id is added in Semana 4 when the work_orders table exists.
    # For now it's a plain int; migration adds the FK when work_orders lands.
    work_order_id: int | None = Field(default=None, index=True)

    # Categorization drives display order + filtering
    category: PhotoCategory = Field(
        sa_column=Column(
            "category",
            sa.Enum(
                PhotoCategory,
                native_enum=False,
                length=20,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        )
    )

    # Storage identity
    storage_key: str = Field(max_length=500, nullable=False, unique=True)
    # Examples:
    #   "photos/2026/04/24/0c72f8e4.jpg"
    #   "photos/inspections/INS-00009/uuid.jpg"   # alt organization if we want
    content_type: str = Field(max_length=50, nullable=False)
    size_bytes: int = Field(nullable=False)

    # Optional EXIF-ish metadata (client sends after compress)
    width: int | None = Field(default=None)
    height: int | None = Field(default=None)

    # Audit
    uploaded_by_id: int = Field(
        foreign_key="users.id", index=True, nullable=False
    )
    uploaded_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )

    # Soft-delete (preserve audit history)
    is_deleted: bool = Field(default=False, nullable=False, index=True)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID. PH-0001 etc."""
        return f"PH-{self.id:04d}" if self.id is not None else ""
