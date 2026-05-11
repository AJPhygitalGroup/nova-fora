"""Work Order V2.0 rebuild — drop V1 tables, create 14 new V2.0 tables

Revision ID: 20260511_1900
Revises: 20260507_0000
Create Date: 2026-05-11 19:00:00.000000

V2.0 (Option 2) Work Order schema rebuild. Adapted from the canonical Notion
spec (`docs/wo-v2-rebuild.md` tracks the divergences). Key adaptations:

  - Flat `public` schema everywhere (spec uses `work_orders.*` namespace).
  - Int FKs to `users.id` directly (spec uses `text 'nova_user:42'` interim).
  - Drops V1 `work_orders` + `work_order_items` outright — no data preservation
    (demo only, no production data).
  - v2.0 active surface only. Cost-approval ping flow, variance reapproval flow,
    AMR/CMR customer split, and Stripe invoicing are deferred — their enum values
    stay in the schema but app never sets them.
  - The 5 `updated_at` triggers from the spec are replaced by a SQLAlchemy
    `before_update` event listener registered in `models/base.py`. The 2
    assertion triggers (defect-repair link check on complete, RO present on
    external-mode accept) are added here as raw SQL.

14 new tables:
  vendor_workshops, dsp_settings, repair_requests, repair_request_defects,
  work_orders, work_order_ros, defect_resolutions, work_order_line_items,
  work_order_line_item_resolutions, work_order_notes, work_order_photos,
  decline_reason_codes, wo_activity_log, defect_reviews

9 enums (stored VARCHAR per CLAUDE.md):
  repair_type, status_tracking_mode, repair_request_status, work_order_status_v2,
  line_item_category, line_item_billing_type, line_item_status,
  defect_resolution_status, note_author_role

Seeds 8 rows in `decline_reason_codes`.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision: str = "20260511_1900"
down_revision: Union[str, None] = "20260507_0000"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ─────────────────────────────────────────────────────────
# Enum value lists (stored as VARCHAR — see CLAUDE.md rule #2).
# Length sized so the longest value fits + headroom for future additions.
# ─────────────────────────────────────────────────────────
REPAIR_TYPE_VALUES = [
    "mechanical", "body", "tires", "pm", "cnmr", "detailing", "netradyne"
]
STATUS_TRACKING_MODE_VALUES = ["external", "internal"]
REPAIR_REQUEST_STATUS_VALUES = ["open", "accepted", "cancelled", "fulfilled", "stale"]
WORK_ORDER_STATUS_VALUES = [
    "pending_acceptance", "accepted", "in_progress",
    "completed", "cancelled", "declined",
]
LINE_ITEM_CATEGORY_VALUES = [
    "defect_repair", "customer_request", "vendor_addition",
    "recall", "overhead", "uncategorized",
]
LINE_ITEM_BILLING_TYPE_VALUES = ["amr", "cmr"]
LINE_ITEM_STATUS_VALUES = [
    "pending_scope_approval",       # waiting on customer (scope)
    "pending_cost_approval",        # waiting on customer (cost) — DORMANT in v2.0
    "pending",                      # approved & ready
    "pending_variance_reapproval",  # final > estimate beyond tolerance — DORMANT in v2.0
    "done", "deferred", "declined",
]
DEFECT_RESOLUTION_STATUS_VALUES = [
    "pending", "in_progress", "resolved", "deferred", "declined"
]
NOTE_AUTHOR_ROLE_VALUES = [
    "customer", "vendor_service_writer", "technician", "admin", "system"
]

ACTIVITY_LOG_ENTITY_TYPES = [
    "repair_request", "work_order", "line_item",
    "defect_resolution", "defect_review", "note", "ro",
]

PHOTO_STAGES = [
    "submission", "completion", "rejection",
    "vehicle_arrival", "key_placement", "parking_spot", "general",
]

# Seed data for decline_reason_codes (spec §3)
DECLINE_REASON_CODE_SEED = [
    ("parts_unavailable",    "Parts not available; will defer to follow-up",     "line_item",  False),
    ("specialty_required",   "Specialty work; needs different vendor",           "work_order", True),
    ("capacity_full",        "Shop at capacity; cannot fit",                     "work_order", True),
    ("customer_unreachable", "Cannot reach customer for clarification",          "work_order", True),
    ("cost_too_high",        "Customer declined the cost",                       "line_item",  True),
    ("safety_concern",       "Safety reason prevents work as scoped",            "line_item",  True),
    ("out_of_warranty",      "Repair not covered",                               "line_item",  True),
    ("other",                "Other (see notes)",                                "work_order", True),
]


def _ts_col(name: str, nullable: bool = False, server_default: str | None = None) -> sa.Column:
    """TIMESTAMPTZ helper matching `models/base.timestamp_column`."""
    kwargs = {"nullable": nullable}
    if server_default is not None:
        kwargs["server_default"] = sa.text(server_default)
    return sa.Column(name, sa.DateTime(timezone=True), **kwargs)


def upgrade() -> None:
    # ─────────────────────────────────────────────────────
    # 1. Drop V1 work orders (CASCADE removes work_order_items + photo FK refs)
    # ─────────────────────────────────────────────────────
    # Photos table may reference work_orders polymorphically — null out first.
    op.execute("UPDATE photos SET work_order_id = NULL WHERE work_order_id IS NOT NULL")
    op.execute("DROP TABLE IF EXISTS work_order_items CASCADE")
    op.execute("DROP TABLE IF EXISTS work_orders CASCADE")

    # ─────────────────────────────────────────────────────
    # 2. decline_reason_codes  (lookup, depended on by work_orders + line_items)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "decline_reason_codes",
        sa.Column("code",        sa.String(length=40), primary_key=True),
        sa.Column("description", sa.String(length=200), nullable=False),
        sa.Column(
            "applies_to",
            sa.String(length=20),
            nullable=False,
        ),
        sa.Column("is_terminal", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.CheckConstraint(
            "applies_to IN ('work_order', 'line_item', 'defect')",
            name="ck_decline_reason_codes_applies_to",
        ),
    )

    # Seed the 8 default codes
    op.bulk_insert(
        sa.table(
            "decline_reason_codes",
            sa.column("code",        sa.String),
            sa.column("description", sa.String),
            sa.column("applies_to",  sa.String),
            sa.column("is_terminal", sa.Boolean),
        ),
        [
            {"code": c, "description": d, "applies_to": a, "is_terminal": t}
            for (c, d, a, t) in DECLINE_REASON_CODE_SEED
        ],
    )

    # ─────────────────────────────────────────────────────
    # 3. vendor_workshops  (per-shop catalog; distinct from organizations)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "vendor_workshops",
        sa.Column("id",   sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column(
            "status_tracking_mode",
            sa.String(length=20),
            nullable=False,
            server_default="external",
        ),
        sa.Column(
            "repair_types",
            ARRAY(sa.String(length=20)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        _ts_col("created_at", server_default="now()"),
        sa.CheckConstraint(
            "status_tracking_mode IN ('external', 'internal')",
            name="ck_vendor_workshops_tracking_mode",
        ),
    )

    # ─────────────────────────────────────────────────────
    # 4. dsp_settings  (per-DSP config; keyed by organization_id)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "dsp_settings",
        sa.Column(
            "dsp_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "cmr_auto_approve_threshold",
            sa.Numeric(10, 2),
            nullable=True,
        ),
        sa.Column(
            "preauth_defect_groups",
            ARRAY(sa.String(length=30)),
            nullable=False,
            server_default="{}",
            comment="defect_group values from the defects schema; defects in these "
                    "groups get auto_preauth_group review decision",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "review_sla_hours",
            sa.Integer(),
            nullable=False,
            server_default="24",
        ),
        sa.Column(
            "default_variance_tolerance",
            sa.Numeric(),
            nullable=False,
            server_default="0.10",
        ),
        sa.Column(
            "bundling_window_minutes",
            sa.Integer(),
            nullable=False,
            server_default="30",
        ),
        _ts_col("created_at", server_default="now()"),
        _ts_col("updated_at", server_default="now()"),
    )

    # ─────────────────────────────────────────────────────
    # 5. repair_requests  (bundling layer between defects and work orders)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "repair_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "dsp_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
            comment="The DSP customer that owns the vehicle. Denormalized for query speed.",
        ),
        sa.Column(
            "repair_type",
            sa.String(length=20),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.String(length=30),
            nullable=False,
            server_default="open",
            index=True,
        ),
        sa.Column("is_rush", sa.Boolean(), nullable=False, server_default=sa.false()),
        _ts_col("sla_due_at", nullable=True),
        sa.Column(
            "parent_repair_request_id",
            sa.Integer(),
            sa.ForeignKey("repair_requests.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
            comment="For follow-up RRs spawned from parts-pending defers or "
                    "deferred items in a previous RR.",
        ),
        _ts_col("created_at", server_default="now()"),
        _ts_col("updated_at", server_default="now()"),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            comment="The Nova user who triggered creation. NULL when "
                    "created by the bundler worker (system).",
        ),
        sa.CheckConstraint(
            f"repair_type IN ({', '.join(repr(v) for v in REPAIR_TYPE_VALUES)})",
            name="ck_repair_requests_repair_type",
        ),
        sa.CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in REPAIR_REQUEST_STATUS_VALUES)})",
            name="ck_repair_requests_status",
        ),
    )

    # ─────────────────────────────────────────────────────
    # 6. repair_request_defects  (M:N RR ↔ Defect)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "repair_request_defects",
        sa.Column(
            "repair_request_id",
            sa.Integer(),
            sa.ForeignKey("repair_requests.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "defect_id",
            sa.Integer(),
            sa.ForeignKey("defects.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_repair_request_defects_defect_id",
        "repair_request_defects",
        ["defect_id"],
    )

    # ─────────────────────────────────────────────────────
    # 7. work_orders  (V2.0 — different shape than V1)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "work_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "repair_request_id",
            sa.Integer(),
            sa.ForeignKey("repair_requests.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "vendor_workshop_id",
            sa.Integer(),
            sa.ForeignKey("vendor_workshops.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "dsp_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
            comment="Denormalized from repair_requests.dsp_id for query speed.",
        ),
        sa.Column(
            "status",
            sa.String(length=30),
            nullable=False,
            server_default="pending_acceptance",
            index=True,
        ),
        sa.Column(
            "status_tracking_mode",
            sa.String(length=20),
            nullable=False,
            comment="Inherited from vendor_workshops at creation time. "
                    "Determines whether RO# is required at acceptance.",
        ),
        sa.Column(
            "assigned_technician_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("is_stale", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_rush",  sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_mileage", sa.Integer(), nullable=True),
        sa.Column("cancelled_reason", sa.Text(), nullable=True),
        sa.Column("declined_reason",  sa.Text(), nullable=True),
        sa.Column(
            "decline_reason_code",
            sa.String(length=40),
            sa.ForeignKey("decline_reason_codes.code", ondelete="RESTRICT"),
            nullable=True,
        ),
        _ts_col("created_at",       server_default="now()"),
        _ts_col("updated_at",       server_default="now()"),
        _ts_col("accepted_at",      nullable=True),
        _ts_col("in_progress_at",   nullable=True),
        _ts_col("completed_at",     nullable=True),
        _ts_col("cancelled_at",     nullable=True),
        _ts_col("declined_at",      nullable=True),
        _ts_col("marked_stale_at",  nullable=True),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in WORK_ORDER_STATUS_VALUES)})",
            name="ck_work_orders_status",
        ),
        sa.CheckConstraint(
            f"status_tracking_mode IN ({', '.join(repr(v) for v in STATUS_TRACKING_MODE_VALUES)})",
            name="ck_work_orders_tracking_mode",
        ),
    )

    # ─────────────────────────────────────────────────────
    # 8. work_order_ros  (RO numbers — multiple per WO, one primary)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "work_order_ros",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "work_order_id",
            sa.Integer(),
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("ro_number", sa.String(length=60), nullable=False),
        sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("modification_reason", sa.Text(), nullable=True),
        _ts_col("added_at", server_default="now()"),
        sa.Column(
            "added_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.UniqueConstraint("work_order_id", "ro_number", name="uq_wo_ros_wo_id_number"),
    )
    # Partial UNIQUE: at most ONE primary RO per WO
    op.execute(
        "CREATE UNIQUE INDEX uq_wo_ros_one_primary "
        "ON work_order_ros (work_order_id) WHERE is_primary"
    )

    # ─────────────────────────────────────────────────────
    # 9. defect_resolutions  (junction WO ↔ Defect with own status)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "defect_resolutions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "work_order_id",
            sa.Integer(),
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "defect_id",
            sa.Integer(),
            sa.ForeignKey("defects.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "status",
            sa.String(length=20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        _ts_col("created_at",  server_default="now()"),
        _ts_col("updated_at",  server_default="now()"),
        _ts_col("resolved_at", nullable=True),
        sa.UniqueConstraint("work_order_id", "defect_id", name="uq_defect_resolutions_wo_defect"),
        sa.CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in DEFECT_RESOLUTION_STATUS_VALUES)})",
            name="ck_defect_resolutions_status",
        ),
    )

    # ─────────────────────────────────────────────────────
    # 10. work_order_line_items  (the actual billable work units)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "work_order_line_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "work_order_id",
            sa.Integer(),
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "ro_id",
            sa.Integer(),
            sa.ForeignKey("work_order_ros.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("description",     sa.Text(), nullable=False),
        sa.Column("estimated_price", sa.Numeric(10, 2), nullable=True),
        sa.Column("final_price",     sa.Numeric(10, 2), nullable=True),
        sa.Column(
            "category",
            sa.String(length=30),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "billing_type",
            sa.String(length=10),
            nullable=False,
            server_default="cmr",
            comment="amr or cmr. In v2.0 the customer doesn't see this split; "
                    "kept for v2.x billing flow.",
        ),
        sa.Column(
            "status",
            sa.String(length=40),
            nullable=False,
            server_default="pending",
            index=True,
            comment="In v2.0, always starts as 'pending' (no cost-approval gating).",
        ),
        sa.Column("status_reason", sa.Text(), nullable=True),
        sa.Column(
            "decline_reason_code",
            sa.String(length=40),
            sa.ForeignKey("decline_reason_codes.code", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column(
            "customer_requested",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        _ts_col("cost_approved_at",        nullable=True),
        _ts_col("customer_reapproved_at",  nullable=True),
        sa.Column("external_source", sa.String(length=40), nullable=True),
        sa.Column("external_id",     sa.String(length=120), nullable=True),
        _ts_col("created_at", server_default="now()"),
        _ts_col("updated_at", server_default="now()"),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint(
            f"category IN ({', '.join(repr(v) for v in LINE_ITEM_CATEGORY_VALUES)})",
            name="ck_wo_line_items_category",
        ),
        sa.CheckConstraint(
            f"billing_type IN ({', '.join(repr(v) for v in LINE_ITEM_BILLING_TYPE_VALUES)})",
            name="ck_wo_line_items_billing_type",
        ),
        sa.CheckConstraint(
            f"status IN ({', '.join(repr(v) for v in LINE_ITEM_STATUS_VALUES)})",
            name="ck_wo_line_items_status",
        ),
    )
    # Partial UNIQUE for external-system upsert idempotency
    op.execute(
        "CREATE UNIQUE INDEX uq_wo_line_items_external_key "
        "ON work_order_line_items (external_source, external_id) "
        "WHERE external_source IS NOT NULL"
    )

    # ─────────────────────────────────────────────────────
    # 11. work_order_line_item_resolutions  (M:N line_item ↔ defect_resolution)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "work_order_line_item_resolutions",
        sa.Column(
            "line_item_id",
            sa.Integer(),
            sa.ForeignKey("work_order_line_items.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "defect_resolution_id",
            sa.Integer(),
            sa.ForeignKey("defect_resolutions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    op.create_index(
        "ix_wo_li_resolutions_dr_id",
        "work_order_line_item_resolutions",
        ["defect_resolution_id"],
    )

    # ─────────────────────────────────────────────────────
    # 12. work_order_notes  (threaded notes with author role)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "work_order_notes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "work_order_id",
            sa.Integer(),
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            comment="NULL for 'system' notes.",
        ),
        sa.Column(
            "author_role",
            sa.String(length=30),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        _ts_col("created_at", server_default="now()"),
        sa.CheckConstraint(
            f"author_role IN ({', '.join(repr(v) for v in NOTE_AUTHOR_ROLE_VALUES)})",
            name="ck_wo_notes_author_role",
        ),
    )
    op.create_index(
        "ix_wo_notes_wo_created",
        "work_order_notes",
        ["work_order_id", "created_at"],
    )

    # ─────────────────────────────────────────────────────
    # 13. work_order_photos  (photos tied to WO / line item / defect_resolution)
    # ─────────────────────────────────────────────────────
    # We keep the existing polymorphic `photos` table untouched (it serves
    # inspection + defect photos). work_order_photos is V2.0-specific because
    # it adds the `stage` enum + line_item_id + defect_resolution_id FKs
    # that the spec's flow needs.
    op.create_table(
        "work_order_photos",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "work_order_id",
            sa.Integer(),
            sa.ForeignKey("work_orders.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "line_item_id",
            sa.Integer(),
            sa.ForeignKey("work_order_line_items.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "defect_resolution_id",
            sa.Integer(),
            sa.ForeignKey("defect_resolutions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("stage",        sa.String(length=30), nullable=False),
        sa.Column("storage_path", sa.String(length=500), nullable=False),
        sa.Column("caption",      sa.Text(), nullable=True),
        _ts_col("created_at", server_default="now()"),
        sa.Column(
            "created_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.CheckConstraint(
            f"stage IN ({', '.join(repr(v) for v in PHOTO_STAGES)})",
            name="ck_wo_photos_stage",
        ),
    )
    op.create_index(
        "ix_wo_photos_line_item",
        "work_order_photos",
        ["line_item_id"],
        postgresql_where=sa.text("line_item_id IS NOT NULL"),
    )

    # ─────────────────────────────────────────────────────
    # 14. wo_activity_log  (audit trail for status transitions + key events)
    # ─────────────────────────────────────────────────────
    # Polymorphic by (entity_type, entity_id) — same pattern as the spec.
    # `details` is jsonb so each action defines its own shape; readers
    # (including the simulator helper) rely on {from, to} for 'status_changed'.
    op.create_table(
        "wo_activity_log",
        sa.Column("id",          sa.Integer(),  primary_key=True),
        sa.Column("entity_type", sa.String(length=30), nullable=False),
        sa.Column("entity_id",   sa.Integer(),  nullable=False),
        sa.Column("action",      sa.String(length=60), nullable=False),
        sa.Column(
            "actor_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            comment="NULL for system-driven actions (bundler, router, schedulers).",
        ),
        sa.Column(
            "details",
            JSONB(),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        _ts_col("created_at", server_default="now()"),
        sa.CheckConstraint(
            f"entity_type IN ({', '.join(repr(v) for v in ACTIVITY_LOG_ENTITY_TYPES)})",
            name="ck_wo_activity_log_entity_type",
        ),
    )
    op.create_index(
        "ix_wo_activity_log_entity",
        "wo_activity_log",
        ["entity_type", "entity_id"],
    )
    op.create_index(
        "ix_wo_activity_log_created",
        "wo_activity_log",
        [sa.text("created_at DESC")],
    )

    # ─────────────────────────────────────────────────────
    # 15. defect_reviews  (scope-approval audit trail)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "defect_reviews",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "defect_id",
            sa.Integer(),
            sa.ForeignKey("defects.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "decision",
            sa.String(length=20),
            nullable=False,
            comment="approved | rejected",
        ),
        sa.Column(
            "decision_method",
            sa.String(length=30),
            nullable=False,
            comment="manual | auto_preauth_group | auto_threshold",
        ),
        sa.Column(
            "reviewer_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
            comment="NULL for automated decisions (decision_method != 'manual').",
        ),
        _ts_col("reviewed_at", server_default="now()"),
        sa.Column("reason", sa.Text(), nullable=True),
        _ts_col("created_at", server_default="now()"),
        sa.CheckConstraint(
            "decision IN ('approved', 'rejected')",
            name="ck_defect_reviews_decision",
        ),
        sa.CheckConstraint(
            "decision_method IN ('manual', 'auto_preauth_group', 'auto_threshold')",
            name="ck_defect_reviews_decision_method",
        ),
    )
    op.create_index(
        "ix_defect_reviews_defect_created",
        "defect_reviews",
        ["defect_id", sa.text("created_at DESC")],
    )
    op.create_index(
        "ix_defect_reviews_decision",
        "defect_reviews",
        ["decision"],
    )

    # ─────────────────────────────────────────────────────
    # 16. Assertion triggers (raw SQL — SQLAlchemy doesn't model these)
    # ─────────────────────────────────────────────────────
    # asyncpg can't run multiple statements in one execute call (no prepared
    # statement batching) — split each CREATE FUNCTION + CREATE TRIGGER pair.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION assert_defect_repair_links_on_complete()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            unlinked_count int;
        BEGIN
            IF NEW.status = 'completed'
               AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
                SELECT count(*) INTO unlinked_count
                FROM work_order_line_items li
                LEFT JOIN work_order_line_item_resolutions lr
                       ON lr.line_item_id = li.id
                WHERE li.work_order_id = NEW.id
                  AND li.category = 'defect_repair'
                  AND lr.line_item_id IS NULL;
                IF unlinked_count > 0 THEN
                    RAISE EXCEPTION
                      'Cannot complete work_order id=%: % defect_repair line item(s) lack defect link',
                      NEW.id, unlinked_count;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_work_orders_assert_defect_repair_links
          BEFORE UPDATE ON work_orders
          FOR EACH ROW EXECUTE FUNCTION assert_defect_repair_links_on_complete()
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION assert_external_mode_ro_present()
        RETURNS trigger LANGUAGE plpgsql AS $$
        DECLARE
            ro_count int;
        BEGIN
            IF NEW.status = 'accepted'
               AND (OLD.status IS NULL OR OLD.status <> 'accepted') THEN
                IF NEW.status_tracking_mode = 'external' THEN
                    SELECT count(*) INTO ro_count
                    FROM work_order_ros
                    WHERE work_order_id = NEW.id;
                    IF ro_count = 0 THEN
                        RAISE EXCEPTION
                          'Cannot accept work_order id=%: external-mode vendor requires at least one RO# before acceptance',
                          NEW.id;
                    END IF;
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_work_orders_assert_external_mode_ro
          BEFORE UPDATE ON work_orders
          FOR EACH ROW EXECUTE FUNCTION assert_external_mode_ro_present()
        """
    )


def downgrade() -> None:
    # ─────────────────────────────────────────────────────
    # Reverse order — drop triggers + functions + tables, then recreate
    # V1 work_orders + work_order_items skeleton so the down stays usable.
    # ─────────────────────────────────────────────────────
    op.execute("DROP TRIGGER IF EXISTS trg_work_orders_assert_external_mode_ro ON work_orders")
    op.execute("DROP TRIGGER IF EXISTS trg_work_orders_assert_defect_repair_links ON work_orders")
    op.execute("DROP FUNCTION IF EXISTS assert_external_mode_ro_present()")
    op.execute("DROP FUNCTION IF EXISTS assert_defect_repair_links_on_complete()")

    op.drop_index("ix_defect_reviews_decision", table_name="defect_reviews")
    op.drop_index("ix_defect_reviews_defect_created", table_name="defect_reviews")
    op.drop_table("defect_reviews")

    op.drop_index("ix_wo_activity_log_created", table_name="wo_activity_log")
    op.drop_index("ix_wo_activity_log_entity", table_name="wo_activity_log")
    op.drop_table("wo_activity_log")

    op.drop_index("ix_wo_photos_line_item", table_name="work_order_photos")
    op.drop_table("work_order_photos")

    op.drop_index("ix_wo_notes_wo_created", table_name="work_order_notes")
    op.drop_table("work_order_notes")

    op.drop_index("ix_wo_li_resolutions_dr_id", table_name="work_order_line_item_resolutions")
    op.drop_table("work_order_line_item_resolutions")

    op.execute("DROP INDEX IF EXISTS uq_wo_line_items_external_key")
    op.drop_table("work_order_line_items")

    op.drop_table("defect_resolutions")

    op.execute("DROP INDEX IF EXISTS uq_wo_ros_one_primary")
    op.drop_table("work_order_ros")

    op.drop_table("work_orders")

    op.drop_index("ix_repair_request_defects_defect_id", table_name="repair_request_defects")
    op.drop_table("repair_request_defects")

    op.drop_table("repair_requests")
    op.drop_table("dsp_settings")
    op.drop_table("vendor_workshops")
    op.drop_table("decline_reason_codes")

    # ─────────────────────────────────────────────────────
    # Recreate the V1 skeleton so the world goes back to "old shape".
    # (Empty tables — V1 data was wiped by the upgrade and isn't restored.)
    # ─────────────────────────────────────────────────────
    op.create_table(
        "work_orders",
        sa.Column("id",       sa.Integer(), primary_key=True),
        sa.Column("dsp_id",   sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("vendor_id", sa.Integer(), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("vehicle_id", sa.Integer(), sa.ForeignKey("vehicles.id"), nullable=False),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("assigned_technician_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column("flags",  ARRAY(sa.String(length=30)), nullable=False, server_default="{}"),
        _ts_col("scheduled_at", nullable=True),
        _ts_col("started_at",   nullable=True),
        _ts_col("completed_at", nullable=True),
        sa.Column("ro_number", sa.String(length=50), nullable=True),
        sa.Column("fmc",       sa.String(length=40), nullable=True),
        sa.Column("parts_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column("labor_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column("notes",         sa.String(length=4000), nullable=True),
        sa.Column("decline_reason", sa.String(length=500), nullable=True),
        sa.Column("cancel_reason",  sa.String(length=500), nullable=True),
        sa.Column("photo_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("item_count",  sa.Integer(), nullable=False, server_default="0"),
        _ts_col("created_at", server_default="now()"),
        _ts_col("updated_at", server_default="now()"),
    )
    op.create_table(
        "work_order_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("work_order_id", sa.Integer(), sa.ForeignKey("work_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("defect_id", sa.Integer(), sa.ForeignKey("defects.id"), nullable=False, unique=True),
        sa.Column("repair_notes", sa.String(length=2000), nullable=True),
        sa.Column("line_parts_cost", sa.Numeric(10, 2), nullable=True),
        sa.Column("line_labor_cost", sa.Numeric(10, 2), nullable=True),
        _ts_col("created_at", server_default="now()"),
    )
