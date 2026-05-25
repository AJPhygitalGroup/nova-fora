"""Defect model — V2.2 standalone `defects` table.

Spec: `docs/defect-schema-v2.2-spec.md` §4.3. The legacy `reported_defects`
table is dropped in the V2.2 migration (no data migration — fresh start).

Properties:
  - Vehicle is mandatory; `inspection_id` is OPTIONAL (defects can come from
    off-inspection sources per `DefectSource`).
  - CHECK constraint: `source = 'inspection'` ↔ `inspection_id IS NOT NULL`.
  - No workflow `status` column — workflow lives in a separate (future)
    `defect_status` table per spec §2.
  - Severity (`DefectClassification`) and routing (`DefectGroup`) are NOT
    stored on the row — derive at read time via JOIN with `defect_applicability`
    and `defect_rule`. Per-row severity overrides land in a future table.
  - All structured: (part, position, defect_type, details). No free-text
    columns beyond `notes`.
"""
from datetime import datetime
from decimal import Decimal
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import CheckConstraint, Column, Numeric
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class DefectSource(str, Enum):
    """How the defect entered the system. V2.2 spec §3.

    `inspection` requires `inspection_id` — enforced by CHECK constraint.
    All other sources require `inspection_id` to be NULL.
    """

    INSPECTION = "inspection"                    # structured DVIC walkaround
    MAINTENANCE_REQUEST = "maintenance_request"  # ticket from DSP / fleet ops
    DRIVER_REPORT = "driver_report"              # driver flagged outside DVIC
    CUSTOMER_REPORT = "customer_report"          # external complaint
    SHOP_FINDING = "shop_finding"                # vendor surfaced during repair work
    OTHER = "other"                              # catchall for ad-hoc entries


class Defect(SQLModel, table=True):
    """One defect on one vehicle, optionally tied to a parent inspection.

    Logical key per the spec: (vehicle_id, inspection_id, part, position, defect_type).
    Unique index (created in the migration as a functional index with COALESCE
    on the nullables) enforces that.

    Enum value columns (`source`, `part`, `position`, `defect_type`) are stored
    as VARCHAR — see app/models/organization.py for the rationale (avoids
    ALTER TYPE downtime when the catalog evolves).
    """

    __tablename__ = "defects"
    __table_args__ = (
        CheckConstraint(
            "(source = 'inspection' AND inspection_id IS NOT NULL) "
            "OR (source <> 'inspection' AND inspection_id IS NULL)",
            name="defects_source_inspection_consistency",
        ),
        # WO V2 iter-1 cost-approval gate (spec §3.15). cost_decision is
        # NULL until SW sets a cost; once set it must resolve to one of two
        # terminal values.
        CheckConstraint(
            "cost_decision IS NULL OR cost_decision IN ('approved', 'rejected')",
            name="defects_cost_decision_chk",
        ),
    )

    id: int | None = Field(default=None, primary_key=True)

    # ── Subject ──
    vehicle_id: int = Field(
        foreign_key="vehicles.id", index=True, nullable=False,
        description="The vehicle the defect is on. Always required.",
    )
    inspection_id: int | None = Field(
        default=None, foreign_key="inspections.id",
        description="Parent inspection, when the defect was found during one. "
                    "NULL for off-inspection sources. The CHECK constraint pairs "
                    "this with `source`.",
    )

    # ── Channel ──
    source: DefectSource = Field(
        sa_column=Column(
            "source",
            sa.Enum(
                DefectSource,
                native_enum=False,
                length=25,  # longest value: 'maintenance_request' = 19 chars
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        ),
    )

    # ── The defect itself ──
    # Stored as enum *values* (strings). Service layer validates against the
    # DefectPart / DefectPosition / DefectType enums in app/models/defect_catalog.py.
    part: str = Field(
        max_length=40, index=True, nullable=False,
        description="DefectPart enum value, e.g. 'tire'.",
    )
    position: str | None = Field(
        default=None, max_length=30,
        description="DefectPosition enum value. NULL when the part has no positional dimension.",
    )
    defect_type: str = Field(
        max_length=40, index=True, nullable=False,
        description="DefectType enum value, e.g. 'low_tread'.",
    )

    # Follow-up answers — validated against defect_details_schema at write time.
    # JSONB so we can index / filter by JSON path (e.g. tread_depth_32nds < 4).
    details: dict = Field(
        default_factory=dict,
        sa_column=Column("details", JSONB, nullable=False, server_default="{}"),
    )

    # Free-text escape hatch — target <5% of rows post-launch.
    notes: str | None = Field(default=None, max_length=2000)

    # ── Reporter ──
    reported_by_id: int = Field(
        foreign_key="users.id", index=True, nullable=False,
        description="The user who reported the defect.",
    )
    reported_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "reported_at",
            sa.DateTime(timezone=True),
            nullable=False,
            index=True,
        ),
    )

    # ── Cost approval (WO V2 iter-1 substitute for line-item cost gate) ──
    # Spec §7.A and §3.15. The Service Writer sets estimated_cost on a
    # scope-approved defect; the customer must approve when the CMR
    # threshold is exceeded or when AMR's FMC cap falls below the vendor
    # estimate (AMR shortfall). fmc_capped_at carries Amazon's cap so the
    # UI can render "FMC approved $700 of $950 — cover the remaining $250?"
    # When iter-2 lights up the line_item.status='pending_cost_approval'
    # flow these columns stay around for AMR-shortfall (per-defect, not
    # per-line) and historical visibility.
    estimated_cost: Decimal | None = Field(
        default=None,
        sa_column=Column("estimated_cost", Numeric(10, 2), nullable=True),
        description="SW's quote for repairing this defect (USD). NULL until set.",
    )
    cost_set_at: datetime | None = Field(
        default=None,
        sa_column=Column("cost_set_at", sa.DateTime(timezone=True), nullable=True),
    )
    cost_set_by: int | None = Field(
        default=None, foreign_key="users.id",
        description="SW user who entered the estimate.",
    )
    cost_decision: str | None = Field(
        default=None, max_length=10,
        description="'approved' or 'rejected' (CHECK constraint); NULL while pending or auto-eligible.",
    )
    cost_decided_at: datetime | None = Field(
        default=None,
        sa_column=Column("cost_decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    cost_decided_by: int | None = Field(
        default=None, foreign_key="users.id",
        description="Customer user who approved/rejected. NULL when decision_method is auto.",
    )
    fmc_capped_at: Decimal | None = Field(
        default=None,
        sa_column=Column("fmc_capped_at", Numeric(10, 2), nullable=True),
        description="Amazon FMC reimbursement cap for AMR defects. When set AND "
                    "below estimated_cost, the customer sees the shortfall ping.",
    )

    # ── Audit ──
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )

    @property
    def id_str(self) -> str:
        """Frontend-compatible ID: FD-XXX (3 digits min, expands as needed).

        V2.2 reuses the FD- prefix that the demo frontend has wired in
        components and mock data. The legacy DEF-XXXXXX prefix from the V2
        partial implementation is retired with this migration."""
        return f"FD-{self.id:03d}" if self.id is not None else ""
