"""photos table — metadata for files stored in MinIO/S3

Revision ID: 20260424_2130
Revises: 20260424_2000
Create Date: 2026-04-24 21:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op

revision: str = "20260424_2130"
down_revision: Union[str, None] = "20260424_2000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "photos",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        # Polymorphic parent columns (exactly one enforced by CHECK)
        sa.Column("inspection_id", sa.Integer(), nullable=True),
        sa.Column("defect_id", sa.Integer(), nullable=True),
        sa.Column("work_order_id", sa.Integer(), nullable=True),

        sa.Column(
            "category", sqlmodel.sql.sqltypes.AutoString(length=20), nullable=False
        ),

        # Storage
        sa.Column(
            "storage_key", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=False
        ),
        sa.Column(
            "content_type", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=False
        ),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),

        # Audit
        sa.Column("uploaded_by_id", sa.Integer(), nullable=False),
        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "is_deleted",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),

        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),

        sa.ForeignKeyConstraint(["inspection_id"], ["inspections.id"]),
        sa.ForeignKeyConstraint(["defect_id"], ["reported_defects.id"]),
        # work_order_id has no FK yet — added in Semana 4 migration when work_orders lands
        sa.ForeignKeyConstraint(["uploaded_by_id"], ["users.id"]),

        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key", name="uq_photos_storage_key"),

        # Exactly one parent must be set
        sa.CheckConstraint(
            "(CASE WHEN inspection_id IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN defect_id IS NOT NULL THEN 1 ELSE 0 END "
            "+ CASE WHEN work_order_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="photos_one_parent_check",
        ),
    )
    op.create_index("ix_photos_inspection_id", "photos", ["inspection_id"])
    op.create_index("ix_photos_defect_id", "photos", ["defect_id"])
    op.create_index("ix_photos_work_order_id", "photos", ["work_order_id"])
    op.create_index("ix_photos_category", "photos", ["category"])
    op.create_index("ix_photos_uploaded_by_id", "photos", ["uploaded_by_id"])
    op.create_index("ix_photos_is_deleted", "photos", ["is_deleted"])
    # Hot path: "photos of this defect, ordered newest first"
    op.create_index(
        "ix_photos_defect_uploaded",
        "photos",
        ["defect_id", sa.text("uploaded_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("ix_photos_defect_uploaded", table_name="photos")
    op.drop_index("ix_photos_is_deleted", table_name="photos")
    op.drop_index("ix_photos_uploaded_by_id", table_name="photos")
    op.drop_index("ix_photos_category", table_name="photos")
    op.drop_index("ix_photos_work_order_id", table_name="photos")
    op.drop_index("ix_photos_defect_id", table_name="photos")
    op.drop_index("ix_photos_inspection_id", table_name="photos")
    op.drop_table("photos")
