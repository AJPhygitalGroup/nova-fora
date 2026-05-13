"""work_orders: scheduling + DSP response fields

Revision ID: 20260513_2200
Revises: 20260512_2000
Create Date: 2026-05-13 22:00:00.000000

Adds five columns to `work_orders` so the vendor can pin a scheduled
slot + bucket when assigning a tech, and the DSP can respond (confirm /
not-available) before the van leaves the lot. The DSP-side "Scheduled
Repairs" home card consumes scheduled_at + repair_bucket + dsp_response
to render the upcoming overnight + shop work.

  scheduled_at      TIMESTAMPTZ NULL   when the repair is expected to run
  repair_bucket     VARCHAR(20) NULL   'overnight' | 'shop' (CHECK)
  dsp_response      VARCHAR(20) NULL   'confirmed' | 'not_available' (CHECK)
  dsp_response_at   TIMESTAMPTZ NULL   when the DSP weighed in
  key_location      VARCHAR(80) NULL   where the keys live for pickup

Indexes on scheduled_at + repair_bucket so the home-card query (DSP +
scheduled_at within 36h) is cheap.

Reversible — all five columns are nullable so existing WOs are untouched.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260513_2200"
down_revision: Union[str, None] = "20260512_2000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "work_orders",
        sa.Column(
            "scheduled_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the vendor plans to start the repair. Drives the "
                    "DSP 'Scheduled Repairs' card.",
        ),
    )
    op.add_column(
        "work_orders",
        sa.Column(
            "repair_bucket",
            sa.String(length=20),
            nullable=True,
            comment="overnight | shop — vendor's classification.",
        ),
    )
    op.add_column(
        "work_orders",
        sa.Column(
            "dsp_response",
            sa.String(length=20),
            nullable=True,
            comment="confirmed | not_available — DSP's response to the "
                    "proposed schedule.",
        ),
    )
    op.add_column(
        "work_orders",
        sa.Column(
            "dsp_response_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )
    op.add_column(
        "work_orders",
        sa.Column(
            "key_location",
            sa.String(length=80),
            nullable=True,
            comment="Free-text pickup-spot hint (mailbox 4, sleeve on cage, …)",
        ),
    )

    op.create_index(
        "ix_work_orders_scheduled_at",
        "work_orders", ["scheduled_at"], unique=False,
    )
    op.create_index(
        "ix_work_orders_repair_bucket",
        "work_orders", ["repair_bucket"], unique=False,
    )

    op.create_check_constraint(
        "ck_work_orders_repair_bucket",
        "work_orders",
        "repair_bucket IS NULL OR repair_bucket IN ('overnight', 'shop')",
    )
    op.create_check_constraint(
        "ck_work_orders_dsp_response",
        "work_orders",
        "dsp_response IS NULL OR dsp_response IN ('confirmed', 'not_available')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_work_orders_dsp_response", "work_orders", type_="check")
    op.drop_constraint("ck_work_orders_repair_bucket", "work_orders", type_="check")
    op.drop_index("ix_work_orders_repair_bucket", table_name="work_orders")
    op.drop_index("ix_work_orders_scheduled_at", table_name="work_orders")
    op.drop_column("work_orders", "key_location")
    op.drop_column("work_orders", "dsp_response_at")
    op.drop_column("work_orders", "dsp_response")
    op.drop_column("work_orders", "repair_bucket")
    op.drop_column("work_orders", "scheduled_at")
