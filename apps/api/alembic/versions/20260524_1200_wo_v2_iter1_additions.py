"""WO V2 iteration-1: defect cost columns + note channel + RO sync state + review.is_rush

Revision ID: 20260524_1200
Revises: 20260515_1400
Create Date: 2026-05-24 12:00:00.000000

Additive-only migration that finishes the WO V2 iter-1 schema per the
updated spec (post-John meeting, 2026-05-24). All fields are nullable
(or DEFAULT-backed) so existing rows are untouched and downgrade is
trivially reversible.

Spec references:
  §3.6  — work_order_ros sync-state columns (13 fields).
  §3.8  — defect_reviews.is_rush.
  §3.11 — work_order_notes.channel ('internal' | 'customer').
  §3.15 — defects iter-1 cost columns (estimated_cost, cost_set_at,
          cost_set_by, cost_decision, cost_decided_at, cost_decided_by,
          fmc_capped_at).

Intentionally NOT touched in this revision:
  - Renames (`work_order_v2 → work_order`): the model already uses
    `work_orders` as the table name; no rename needed.
  - work_order_assert_defect_repair_links trigger: stays disabled
    (iter-2 line-item flow not active).
  - work_order_assert_external_mode_ro_present trigger: stays disabled
    (status_tracking_mode is dormant in iter-1).
  - V1 cleanup (`work_order_legacy` drop): handled in a separate
    follow-up migration once the v1 surface is fully decommissioned.
  - customer_preferred_vendor table: still TBD.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "20260524_1200"
down_revision: Union[str, None] = "20260515_1400"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1) defects: iter-1 cost-approval columns (spec §3.15) ─────────
    op.add_column(
        "defects",
        sa.Column("estimated_cost", sa.Numeric(10, 2), nullable=True),
    )
    op.add_column(
        "defects",
        sa.Column("cost_set_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "defects",
        sa.Column(
            "cost_set_by",
            sa.Integer,
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "defects",
        sa.Column("cost_decision", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "defects",
        sa.Column("cost_decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "defects",
        sa.Column(
            "cost_decided_by",
            sa.Integer,
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "defects",
        sa.Column("fmc_capped_at", sa.Numeric(10, 2), nullable=True),
    )
    # CHECK constraint: cost_decision must be approved/rejected or NULL.
    op.create_check_constraint(
        "defects_cost_decision_chk",
        "defects",
        "cost_decision IS NULL OR cost_decision IN ('approved', 'rejected')",
    )

    # ── 2) work_order_notes: channel discriminator (spec §3.11) ───────
    op.add_column(
        "work_order_notes",
        sa.Column(
            "channel",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'internal'"),
        ),
    )
    op.create_check_constraint(
        "work_order_notes_channel_chk",
        "work_order_notes",
        "channel IN ('internal', 'customer')",
    )

    # ── 3) defect_reviews: is_rush flag (spec §3.8) ──────────────────
    op.add_column(
        "defect_reviews",
        sa.Column(
            "is_rush",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # ── 4) work_order_ros: vendor-system sync columns (spec §3.6) ────
    op.add_column(
        "work_order_ros",
        sa.Column("parts_ordered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("parts_received_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("submitted_to_fmc_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("fmc_approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("scheduled_start_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("pickup_requested_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("pickup_type", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("pickup_duration_text", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("pickup_location", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("pickup_notes", sa.Text(), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("key_location", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("vendor_status", sa.String(length=60), nullable=True),
    )
    op.add_column(
        "work_order_ros",
        sa.Column("estimated_duration_minutes", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "work_order_ros_pickup_type_chk",
        "work_order_ros",
        "pickup_type IS NULL OR pickup_type IN ('overnight_rush', 'in_shop')",
    )


def downgrade() -> None:
    # ── work_order_ros ──
    op.drop_constraint("work_order_ros_pickup_type_chk", "work_order_ros", type_="check")
    op.drop_column("work_order_ros", "estimated_duration_minutes")
    op.drop_column("work_order_ros", "vendor_status")
    op.drop_column("work_order_ros", "key_location")
    op.drop_column("work_order_ros", "pickup_notes")
    op.drop_column("work_order_ros", "pickup_location")
    op.drop_column("work_order_ros", "pickup_duration_text")
    op.drop_column("work_order_ros", "pickup_type")
    op.drop_column("work_order_ros", "pickup_requested_at")
    op.drop_column("work_order_ros", "scheduled_start_at")
    op.drop_column("work_order_ros", "fmc_approved_at")
    op.drop_column("work_order_ros", "submitted_to_fmc_at")
    op.drop_column("work_order_ros", "parts_received_at")
    op.drop_column("work_order_ros", "parts_ordered_at")

    # ── defect_reviews ──
    op.drop_column("defect_reviews", "is_rush")

    # ── work_order_notes ──
    op.drop_constraint("work_order_notes_channel_chk", "work_order_notes", type_="check")
    op.drop_column("work_order_notes", "channel")

    # ── defects ──
    op.drop_constraint("defects_cost_decision_chk", "defects", type_="check")
    op.drop_column("defects", "fmc_capped_at")
    op.drop_column("defects", "cost_decided_by")
    op.drop_column("defects", "cost_decided_at")
    op.drop_column("defects", "cost_decision")
    op.drop_column("defects", "cost_set_by")
    op.drop_column("defects", "cost_set_at")
    op.drop_column("defects", "estimated_cost")
