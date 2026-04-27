"""work orders + work order items tables, photos.work_order_id FK

Revision ID: 20260428_0010
Revises: 20260427_2350
Create Date: 2026-04-28 00:10:00.000000

Phase 1 of Work Orders:
  - work_orders            (1 row per repair job)
  - work_order_items       (junction WO ↔ ReportedDefect, UNIQUE(defect_id))
  - photos.work_order_id   FK constraint added (column existed since photos
                            migration; now properly references work_orders.id)

All status values stored as VARCHAR(20) (native_enum=False) for the same
reasons we use it elsewhere — values can rotate without schema migrations.
"""
from typing import Sequence, Union

import sqlalchemy as sa
import sqlmodel
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision: str = "20260428_0010"
down_revision: Union[str, None] = "20260427_2350"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── work_orders ──
    op.create_table(
        "work_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        # Parties
        sa.Column("dsp_id", sa.Integer(), nullable=False),
        sa.Column("vendor_id", sa.Integer(), nullable=False),
        sa.Column("vehicle_id", sa.Integer(), nullable=False),
        # People
        sa.Column("created_by_id", sa.Integer(), nullable=False),
        sa.Column("assigned_technician_id", sa.Integer(), nullable=True),
        # Workflow
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "flags",
            ARRAY(sa.String(length=30)),
            nullable=False,
            server_default="{}",
        ),
        # Schedule
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        # Commercial
        sa.Column("ro_number", sqlmodel.sql.sqltypes.AutoString(length=50), nullable=True),
        sa.Column("fmc", sqlmodel.sql.sqltypes.AutoString(length=40), nullable=True),
        sa.Column("parts_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column("labor_cost", sa.Numeric(10, 2), nullable=True),
        # Reasons / context
        sa.Column("notes", sqlmodel.sql.sqltypes.AutoString(length=4000), nullable=True),
        sa.Column("decline_reason", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        sa.Column("cancel_reason", sqlmodel.sql.sqltypes.AutoString(length=500), nullable=True),
        # Counters
        sa.Column("photo_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
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
        # FKs
        sa.ForeignKeyConstraint(["dsp_id"], ["organizations.id"], name="fk_work_orders_dsp_id"),
        sa.ForeignKeyConstraint(["vendor_id"], ["organizations.id"], name="fk_work_orders_vendor_id"),
        sa.ForeignKeyConstraint(["vehicle_id"], ["vehicles.id"], name="fk_work_orders_vehicle_id"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], name="fk_work_orders_created_by_id"),
        sa.ForeignKeyConstraint(
            ["assigned_technician_id"], ["users.id"],
            name="fk_work_orders_assigned_technician_id",
        ),
    )
    op.create_index("ix_work_orders_dsp_id", "work_orders", ["dsp_id"])
    op.create_index("ix_work_orders_vendor_id", "work_orders", ["vendor_id"])
    op.create_index("ix_work_orders_vehicle_id", "work_orders", ["vehicle_id"])
    op.create_index("ix_work_orders_status", "work_orders", ["status"])
    op.create_index("ix_work_orders_scheduled_at", "work_orders", ["scheduled_at"])
    op.create_index("ix_work_orders_completed_at", "work_orders", ["completed_at"])
    op.create_index("ix_work_orders_ro_number", "work_orders", ["ro_number"])
    op.create_index(
        "ix_work_orders_assigned_technician_id",
        "work_orders",
        ["assigned_technician_id"],
    )
    op.create_index("ix_work_orders_created_by_id", "work_orders", ["created_by_id"])

    # ── work_order_items ──
    op.create_table(
        "work_order_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("work_order_id", sa.Integer(), nullable=False),
        sa.Column("defect_id", sa.Integer(), nullable=False),
        sa.Column("repair_notes", sqlmodel.sql.sqltypes.AutoString(length=2000), nullable=True),
        sa.Column("line_parts_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column("line_labor_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["work_order_id"], ["work_orders.id"],
            ondelete="CASCADE",
            name="fk_work_order_items_work_order_id",
        ),
        sa.ForeignKeyConstraint(
            ["defect_id"], ["reported_defects.id"],
            name="fk_work_order_items_defect_id",
        ),
        sa.UniqueConstraint("defect_id", name="uq_work_order_items_defect"),
    )
    op.create_index(
        "ix_work_order_items_work_order_id",
        "work_order_items",
        ["work_order_id"],
    )
    op.create_index("ix_work_order_items_defect_id", "work_order_items", ["defect_id"])

    # ── photos.work_order_id: add FK constraint (column already exists) ──
    op.create_foreign_key(
        "fk_photos_work_order_id",
        "photos", "work_orders",
        ["work_order_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_photos_work_order_id", "photos", type_="foreignkey")

    op.drop_index("ix_work_order_items_defect_id", table_name="work_order_items")
    op.drop_index("ix_work_order_items_work_order_id", table_name="work_order_items")
    op.drop_table("work_order_items")

    op.drop_index("ix_work_orders_created_by_id", table_name="work_orders")
    op.drop_index("ix_work_orders_assigned_technician_id", table_name="work_orders")
    op.drop_index("ix_work_orders_ro_number", table_name="work_orders")
    op.drop_index("ix_work_orders_completed_at", table_name="work_orders")
    op.drop_index("ix_work_orders_scheduled_at", table_name="work_orders")
    op.drop_index("ix_work_orders_status", table_name="work_orders")
    op.drop_index("ix_work_orders_vehicle_id", table_name="work_orders")
    op.drop_index("ix_work_orders_vendor_id", table_name="work_orders")
    op.drop_index("ix_work_orders_dsp_id", table_name="work_orders")
    op.drop_table("work_orders")
