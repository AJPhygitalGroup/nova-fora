"""work_orders: add picked_up_at + picked_up_by_id (checkout flow)

Pilot bug round 2026-06-02 Phase B — tech-side "I have the vehicle"
checkout. Decouples physical custody (vendor has the van) from
work-started (tech is wrenching). Both transitions stay distinct on
the SW dashboard so the DSP sees "vehicle picked up" the moment it
happens, even if work doesn't start for a few hours.

Vehicle-scoped: when one tech checks out a van, the endpoint writes
the same `picked_up_at` + `picked_up_by_id` to every accepted sibling
WO on the vehicle (same pattern as `confirm_pickup`). Photos are
recorded only on the target WO via `WorkOrderPhoto` rows with stage
`vehicle_arrival` — that enum value already exists, no schema bump
needed there.

Backfill: NOT triggered. Historical WOs stay NULL — they pre-date this
field and weren't required to have it. The frontend treats
`pickedUpAt == null` as "not yet checked out", which is correct for
the historical set.

Revision ID: 20260602_1900_work_orders_picked_up_cols
Revises: 20260531_1700_auth_audit_log_table
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260602_1900_work_orders_picked_up_cols"
down_revision = "20260531_1700_auth_audit_log_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_orders",
        sa.Column(
            "picked_up_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "work_orders",
        sa.Column(
            "picked_up_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Index on picked_up_at so the "vehicles currently at shops" query
    # (status=in_progress OR picked_up_at IS NOT NULL) doesn't scan.
    op.create_index(
        "ix_work_orders_picked_up_at",
        "work_orders",
        ["picked_up_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_work_orders_picked_up_at", table_name="work_orders")
    op.drop_column("work_orders", "picked_up_by_id")
    op.drop_column("work_orders", "picked_up_at")
