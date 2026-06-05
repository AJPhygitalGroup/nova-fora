"""BodyRepairQuote + line items + revisions — Phase 2 port.

Faithful port of NOVABODY/core@mbk/body-repair-demo's
nova/core/models/body_repair_quote.py (230 lines, 4 tables).
Adapted to nova-fora's SQLModel + tenancy conventions:
  - VARCHAR(N) for enums (sa.Enum native_enum=False) rather than PG ENUM.
  - TIMESTAMPTZ timestamps via timestamp_column / DateTime(timezone=True).
  - id_str pattern: BRQ-NNNNN for quotes, BRL-NNNNN for line items,
    BRV-NNNNN for revisions, BRLR-NNNNN for revision line items.
  - Pricing semantics PRESERVED VERBATIM — the customer/vendor/admin
    serialize views in the demo are encoded as enum-typed columns plus
    helper properties on the model. Routes hand-pick the right
    projection at response build time (no hidden serialization).

Pricing model (mirrors demo's `markup_quote`):
  base = round(vendor_raw_cents * (1 + commission_pct / 100))
  list_cents = tier_1_cents = tier_2_cents = base   (tier columns kept
    for forward compat with the demo's reward-tier flow; equal to list
    until the tier ladder relaunches.)
  platform_fee_cents = max(0, list_cents - vendor_raw_cents)

Disclosure rules (enforced at the route layer):
  - customer view sees:  list_cents, platform_fee_cents, line items
                         at vendor_raw_cents (no per-item markup).
  - vendor view sees:    vendor_raw_cents, line items at raw cost.
  - admin view sees:     ALL fields including commission_pct + base.
"""

from datetime import datetime
from decimal import Decimal
from enum import Enum

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class BodyRepairQuoteStatus(str, Enum):
    """Lifecycle of a single vendor bid on a request.

    active   — submitted and within valid_until (default).
    selected — the customer picked this quote; request moves forward.
    declined — the customer rejected this quote (others may still be
               active for the same request).
    expired  — valid_until passed without selection or decline.
    """

    ACTIVE = "active"
    SELECTED = "selected"
    DECLINED = "declined"
    EXPIRED = "expired"


class BodyRepairRevisionStatus(str, Enum):
    """Scope-change lifecycle (Phase 4 surface).

    proposed — vendor flagged a mid-repair change; awaiting customer.
    applied  — the change went through (auto-applied within threshold
               OR customer approved).
    approved — the customer approved a proposed delta but apply hasn't
               run yet (Phase 4 will collapse this into 'applied').
    declined — the customer rejected the change; vendor must absorb
               or escalate.
    """

    PROPOSED = "proposed"
    APPLIED = "applied"
    APPROVED = "approved"
    DECLINED = "declined"


class BodyRepairQuote(SQLModel, table=True):
    __tablename__ = "body_repair_quotes"

    id: int | None = Field(default=None, primary_key=True)

    # Owning request — CASCADE so dropping a request takes its bids
    # along (audit lives via WoActivityLog / messages, not quote rows).
    body_repair_request_id: int = Field(
        sa_column=Column(
            "body_repair_request_id",
            sa.Integer,
            sa.ForeignKey("body_repair_requests.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    # The vendor org that submitted this quote. RESTRICT — never delete
    # an org with outstanding bids; deactivate instead.
    vendor_org_id: int = Field(
        sa_column=Column(
            "vendor_org_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
    )

    status: BodyRepairQuoteStatus = Field(
        default=BodyRepairQuoteStatus.ACTIVE,
        sa_column=Column(
            "status",
            sa.Enum(
                BodyRepairQuoteStatus,
                native_enum=False,
                length=15,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        ),
    )

    # ── Pricing (all integer cents) ─────────────────────────
    # vendor_raw_cents — the vendor's actual cost. NEVER exposed to the
    # customer at any response layer. The model_validator at the route
    # layer enforces the disclosure rule.
    vendor_raw_cents: int = Field(default=0)
    # base_cents = round(vendor_raw * (1 + commission_pct/100)). Kept
    # explicitly so the math is auditable + same value the customer pays.
    base_cents: int = Field(default=0)
    # list_cents — what the customer pays. Equal to base in the current
    # markup model; kept distinct for forward compat with deal-of-the-day
    # surfacing where list might differ.
    list_cents: int = Field(default=0)
    # tier_1/tier_2_cents — DA reward tier discounts. Currently equal
    # to list (no active discount) but kept so a future tier ladder
    # doesn't need a migration.
    tier_1_cents: int = Field(default=0)
    tier_2_cents: int = Field(default=0)

    # Numeric(5, 2) — precision matches the demo's PG schema. 999.99%
    # max which is plenty for any plausible commission.
    commission_pct: Decimal | None = Field(
        default=None,
        sa_column=Column("commission_pct", sa.Numeric(5, 2), nullable=True),
    )

    duration_days: int | None = Field(default=None)
    notes: str | None = Field(default=None, sa_column=Column("notes", sa.Text, nullable=True))

    valid_until: datetime | None = Field(
        default=None,
        sa_column=Column("valid_until", sa.DateTime(timezone=True), nullable=True, index=True),
    )
    renewed_count: int = Field(default=0)

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        if self.id is None:
            return ""
        return f"BRQ-{self.id:05d}"

    @property
    def platform_fee_cents(self) -> int:
        """Customer-side breakdown — what they're paying Nova on top of
        the vendor cost. Derived, never stored (so an admin tweak to
        list / vendor_raw automatically refreshes the fee shown)."""
        return max(0, (self.list_cents or 0) - (self.vendor_raw_cents or 0))


class BodyRepairQuoteLineItem(SQLModel, table=True):
    """One scope item on a quote — e.g. 'Driver-side rear panel — replace'.

    Per-line money is the vendor's raw cost split into parts vs labor.
    The customer's quote view shows totals only (no per-line markup);
    the vendor + admin see the raw split.
    """

    __tablename__ = "body_repair_quote_line_items"

    id: int | None = Field(default=None, primary_key=True)
    quote_id: int = Field(
        sa_column=Column(
            "quote_id",
            sa.Integer,
            sa.ForeignKey("body_repair_quotes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    position: int = Field(default=0)
    description: str | None = Field(default=None, sa_column=Column("description", sa.Text, nullable=True))
    parts_cents: int = Field(default=0)
    labor_cents: int = Field(default=0)

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))

    @property
    def id_str(self) -> str:
        if self.id is None:
            return ""
        return f"BRL-{self.id:05d}"

    @property
    def total_cents(self) -> int:
        return (self.parts_cents or 0) + (self.labor_cents or 0)


class BodyRepairQuoteRevision(SQLModel, table=True):
    """Mid-repair scope change. Tracks BOTH:
      - the deltas vs the originally-selected quote (for the customer
        decision pane: "approve $850 extra?"), AND
      - the full new pricing payload so applying the revision flips
        the quote columns in one atomic write.

    Phase 4 will drive most of the writes here; Phase 2 ships the
    schema so the foreign keys exist when quotes do."""

    __tablename__ = "body_repair_quote_revisions"

    id: int | None = Field(default=None, primary_key=True)
    quote_id: int = Field(
        sa_column=Column(
            "quote_id",
            sa.Integer,
            sa.ForeignKey("body_repair_quotes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    status: BodyRepairRevisionStatus = Field(
        default=BodyRepairRevisionStatus.PROPOSED,
        sa_column=Column(
            "status",
            sa.Enum(
                BodyRepairRevisionStatus,
                native_enum=False,
                length=15,
                values_callable=lambda e: [m.value for m in e],
            ),
            nullable=False,
            index=True,
        ),
    )

    # Customer-side delta — "list went from X to Y, approve?"
    old_list_cents: int | None = Field(default=None)
    new_list_cents: int | None = Field(default=None)
    baseline_cents: int | None = Field(default=None)
    delta_cents: int | None = Field(default=None)

    # If True, the revision was auto-applied (under the safe-threshold).
    auto_applied: bool = Field(default=False)
    reason: str | None = Field(default=None, sa_column=Column("reason", sa.Text, nullable=True))

    # Full new pricing — applying the revision copies these onto the
    # quote without needing to recompute. Verbatim from demo schema.
    new_vendor_raw_cents: int | None = Field(default=None)
    new_base_cents: int | None = Field(default=None)
    new_tier_1_cents: int | None = Field(default=None)
    new_tier_2_cents: int | None = Field(default=None)

    new_duration_days: int | None = Field(default=None)
    old_duration_days: int | None = Field(default=None)

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        if self.id is None:
            return ""
        return f"BRV-{self.id:05d}"


class BodyRepairQuoteRevisionLineItem(SQLModel, table=True):
    """Same shape as quote line items but scoped to a revision. Lets the
    vendor surface the NEW scope (not just the price delta) for customer
    review."""

    __tablename__ = "body_repair_quote_revision_line_items"

    id: int | None = Field(default=None, primary_key=True)
    revision_id: int = Field(
        sa_column=Column(
            "revision_id",
            sa.Integer,
            sa.ForeignKey("body_repair_quote_revisions.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    position: int = Field(default=0)
    description: str | None = Field(default=None, sa_column=Column("description", sa.Text, nullable=True))
    parts_cents: int = Field(default=0)
    labor_cents: int = Field(default=0)

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))

    @property
    def id_str(self) -> str:
        if self.id is None:
            return ""
        return f"BRLR-{self.id:05d}"

    @property
    def total_cents(self) -> int:
        return (self.parts_cents or 0) + (self.labor_cents or 0)
