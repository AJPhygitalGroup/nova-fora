"""dvic_schedules table — vendor-scheduled QC DVIC appointments

Replaces the day-flag-only `dvic_nightly_confirmations` flow with real
scheduled appointments carrying a `scheduled_at` timestamp. The DSP
banner uses this to auto-trigger 12 hours before each appointment.

Revision ID: 20260527_1922
Revises: 20260526_2000
Create Date: 2026-05-27 19:22:00.000000+00:00
"""
from typing import Union

import sqlalchemy as sa
from alembic import op


revision: str = '20260527_1922'
down_revision: Union[str, None] = '20260526_2000'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dvic_schedules",
        sa.Column("id", sa.Integer(), nullable=False, autoincrement=True),
        sa.Column("vendor_workshop_id", sa.Integer(), nullable=False),
        sa.Column("dsp_id", sa.Integer(), nullable=False),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_by_id", sa.Integer(), nullable=True),
        sa.Column("cancellation_reason", sa.String(length=200), nullable=True),
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["vendor_workshop_id"], ["vendor_workshops.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["dsp_id"], ["organizations.id"], ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["cancelled_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.CheckConstraint(
            "(cancelled_at IS NULL AND cancelled_by_id IS NULL) "
            "OR (cancelled_at IS NOT NULL AND cancelled_by_id IS NOT NULL)",
            name="dvic_schedules_cancellation_consistency",
        ),
    )
    # Hot-path queries are: "upcoming for this workshop" and "next within
    # 12h for this DSP". Both filter active rows by scheduled_at — index
    # accordingly.
    op.create_index(
        "ix_dvic_schedules_workshop_active",
        "dvic_schedules",
        ["vendor_workshop_id", "scheduled_at"],
        postgresql_where=sa.text("cancelled_at IS NULL"),
    )
    op.create_index(
        "ix_dvic_schedules_dsp_active",
        "dvic_schedules",
        ["dsp_id", "scheduled_at"],
        postgresql_where=sa.text("cancelled_at IS NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_dvic_schedules_dsp_active", table_name="dvic_schedules")
    op.drop_index(
        "ix_dvic_schedules_workshop_active", table_name="dvic_schedules",
    )
    op.drop_table("dvic_schedules")
