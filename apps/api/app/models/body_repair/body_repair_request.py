"""BodyRepairRequest — the customer's submission for a body / collision job.

Port of the `Request` dataclass shape from web-mbk-body-repair-demo's
body_repair_demo.py (in-memory store). Adapted to SQLModel + Postgres
+ Nova Fora's id_str / tenancy conventions:

  - id is the internal int PK; id_str = "BRR-NNNNN" for the wire.
  - dsp_id + vehicle_id are required FKs (tenancy anchor).
  - assigned_vendor_id is nullable until the customer selects a quote.
  - 16-state lifecycle stored as VARCHAR(30) — extends easily without
    ALTER TYPE migrations.
  - Submission mode + payload fields cover all 3 entry paths (text /
    pick parts / target grade). Only `text_description` is populated
    in Phase 0; the others fill in as later phases land.

Future entities that will reference this table:
  - body_repair_quotes (FK request_id) — vendor quote rows.
  - body_repair_pave_reports (FK request_id) — pre/post PAVE PDFs +
    parsed photo bags.
  - body_repair_messages (FK request_id) — customer ↔ vendor thread.
  - body_repair_activity (FK request_id) — append-only audit log.

Iter-1 forward-compat columns (added now to avoid Alembic churn later):
  selected_quote_id, pickup_*, completion_*, payment_*. Most are NULL
  in Phase 0 and only get set by later-phase endpoints.
"""

from datetime import datetime
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class BodyRepairRequestStatus(str, Enum):
    """10 progression states + 3 exceptions, mirrors STATUS_PROGRESSION
    from web-mbk-body-repair-demo/app/body_repair_demo.py (line 239).

    Per-role labels (sw vs customer) and KPI tile labels live on the
    frontend — only the canonical key is stored here.
    """

    # ── Happy path (10 steps) ──────────────────────────────
    PENDING_QUOTES = "pending_quotes"        # request just submitted
    QUOTED = "quoted"                        # ≥1 vendor quote arrived
    QUOTE_SELECTED = "quote_selected"        # customer picked one
    PICKUP_PROPOSED = "pickup_proposed"      # vendor proposed a window
    PICKUP_CONFIRMED = "pickup_confirmed"    # customer confirmed
    IN_REPAIR = "in_repair"                  # vendor picked up the van
    REPAIR_COMPLETE = "repair_complete"      # ready to drop off
    PENDING_SIGNOFF = "pending_signoff"      # van back, customer to confirm
    RETURNED = "returned"                    # signed off, awaiting payment
    PAID = "paid"                            # closed
    # ── Exception states ───────────────────────────────────
    CANCELLED = "cancelled"
    NO_ELIGIBLE_VENDOR = "no_eligible_vendor"
    HALTED = "halted"                        # DFS-side review hold


class BodyRepairSubmissionMode(str, Enum):
    """How the customer described the job at submission time.

    TEXT  — free-form description (Phase 0 entry path).
    PARTS — picked specific items from the parsed pre-PAVE report.
    GRADE — named a target fleet condition score; backend resolves
            which items must be addressed to reach it.
    """

    TEXT = "text"
    PARTS = "parts"
    GRADE = "grade"


class BodyRepairRequest(SQLModel, table=True):
    __tablename__ = "body_repair_requests"

    id: int | None = Field(default=None, primary_key=True)

    # ── Tenancy anchors — same shape as WorkOrder / Inspection ─────
    dsp_id: int = Field(
        sa_column=Column(
            "dsp_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
    )
    vehicle_id: int = Field(
        sa_column=Column(
            "vehicle_id",
            sa.Integer,
            sa.ForeignKey("vehicles.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
    )
    # NULL until the customer selects a quote — the request can shop
    # multiple vendors before locking in.
    assigned_vendor_id: int | None = Field(
        default=None,
        sa_column=Column(
            "assigned_vendor_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )

    # ── Submission payload ─────────────────────────────────
    submission_mode: BodyRepairSubmissionMode = Field(
        sa_column=Column(
            "submission_mode",
            sa.Enum(
                BodyRepairSubmissionMode,
                native_enum=False,
                length=10,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
        ),
    )
    # Phase 0 — text-mode payload. The 'parts' and 'grade' modes will
    # land in Phase 1 via separate columns / related tables; this stays
    # the canonical free-text field for all modes.
    text_description: str | None = Field(default=None, sa_column=Column("text_description", sa.Text, nullable=True))
    # Phase 1 forward-compat:
    target_grade: str | None = Field(default=None, max_length=20)  # 'mint' / 'excellent' / ...
    picked_components_json: dict | None = Field(default=None, sa_column=Column("picked_components_json", sa.JSON, nullable=True))

    # ── Lifecycle ──────────────────────────────────────────
    status: BodyRepairRequestStatus = Field(
        default=BodyRepairRequestStatus.PENDING_QUOTES,
        sa_column=Column(
            "status",
            sa.Enum(
                BodyRepairRequestStatus,
                native_enum=False,
                length=30,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        ),
    )

    # ── Quote stage (Phase 2-3) ────────────────────────────
    selected_quote_id: int | None = Field(default=None, index=True)
    quote_selected_at: datetime | None = Field(
        default=None,
        sa_column=Column("quote_selected_at", sa.DateTime(timezone=True), nullable=True),
    )
    # The customer-approved list price at the moment of selection. The
    # vendor's mid-repair revisions measure their auto-apply headroom
    # against this baseline — only an explicit customer approval bumps
    # it forward. Critical for the "salami guard" against repeated
    # small bumps. NULL until quote_selected_at fires.
    approved_list_cents: int | None = Field(default=None)

    # ── Pickup stage (Phase 3-4) ───────────────────────────
    pickup_proposed_at: datetime | None = Field(
        default=None,
        sa_column=Column("pickup_proposed_at", sa.DateTime(timezone=True), nullable=True),
    )
    pickup_confirmed_at: datetime | None = Field(
        default=None,
        sa_column=Column("pickup_confirmed_at", sa.DateTime(timezone=True), nullable=True),
    )
    pickup_window: str | None = Field(default=None, max_length=60)
    pickup_proposed_date: datetime | None = Field(
        default=None,
        sa_column=Column("pickup_proposed_date", sa.DateTime(timezone=True), nullable=True),
    )

    # ── Repair + completion (Phase 4) ──────────────────────
    picked_up_at: datetime | None = Field(
        default=None,
        sa_column=Column("picked_up_at", sa.DateTime(timezone=True), nullable=True),
    )
    repair_started_at: datetime | None = Field(
        default=None,
        sa_column=Column("repair_started_at", sa.DateTime(timezone=True), nullable=True),
    )
    repair_completed_at: datetime | None = Field(
        default=None,
        sa_column=Column("repair_completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    returned_at: datetime | None = Field(
        default=None,
        sa_column=Column("returned_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── Payment (Phase 5) ──────────────────────────────────
    paid_at: datetime | None = Field(
        default=None,
        sa_column=Column("paid_at", sa.DateTime(timezone=True), nullable=True),
    )
    paid_amount_cents: int | None = Field(default=None)

    # ── Audit ──────────────────────────────────────────────
    created_by_id: int | None = Field(
        default=None,
        sa_column=Column(
            "created_by_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    cancelled_reason: str | None = Field(default=None, max_length=500)

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        """Wire-format ID — matches Nova Fora's prefixed-int pattern.

        BRR-NNNNN (Body Repair Request). Routes accept either form
        following the existing convention.
        """
        if self.id is None:
            return ""
        return f"BRR-{self.id:05d}"
