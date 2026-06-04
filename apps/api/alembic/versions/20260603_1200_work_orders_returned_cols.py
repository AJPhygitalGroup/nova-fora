"""work_orders: add returned_at + returned_by_id (check-in flow)

Jorge 2026-06-03: symmetric counterpart to Phase B's check-out.
After the tech repairs the vehicle, they drop it back at the DSP lot
and snap return-state photos via POST /work-orders/{id}/checkin —
proving "I returned the van in this condition." Decoupled from
completed_at (work-done + invoice settled) so the DSP sees physical
return immediately, even if paperwork lags.

Vehicle-scoped: when one tech returns a van, the endpoint writes
returned_at + returned_by_id to every accepted sibling WO that was
also picked up (one truck trip, one return event). Photos go on
the target WO only via WorkOrderPhoto with stage='vehicle_return'.
The frontend joins vehicle-wide so the DSP sees the same gallery
across siblings.

Backfill: NOT triggered. Historical picked-up WOs stay returned_at
NULL — the DSP-side modal treats that as "still with vendor", which
is the safe interpretation.

Revision ID: 20260603_1200
Revises: 20260602_1900
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260603_1200"
down_revision = "20260602_1900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "work_orders",
        sa.Column(
            "returned_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "work_orders",
        sa.Column(
            "returned_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Index on returned_at — the DSP "Returned today" section filters by
    # `returned_at >= now() - 24h`, which scans without an index.
    op.create_index(
        "ix_work_orders_returned_at",
        "work_orders",
        ["returned_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_work_orders_returned_at", table_name="work_orders")
    op.drop_column("work_orders", "returned_by_id")
    op.drop_column("work_orders", "returned_at")
