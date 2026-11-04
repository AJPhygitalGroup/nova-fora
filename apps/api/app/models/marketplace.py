"""DFS CMR repair marketplace — Phase 1 tables.

Spec: `Sales Agent/docs/spec.md` v0.4 (§3 rules, §4 lifecycle, §6 fee,
§8 shops, §9 DSP approval). Everything follows the repo conventions:
VARCHAR enums (`native_enum=False`), TIMESTAMPTZ via `timestamp_column`,
prefixed string IDs via `id_str`.

Tables
------
- `marketplace_rules`        — (part, defect_types[]) → specialty. Which
                               defects count as DSP-paid ("CMR") damage.
                               NOT `DefectGroup.CMR` (that means Commercial
                               Motor Repair in the catalog).
- `marketplace_shop_profiles` — one per `vendor` / `body_repair_vendor` org:
                               contact email, specialties, onboarding
                               status, terms acceptance, prospect magic link.
- `marketplace_offers`       — one per eligible defect (open → awarded |
                               withdrawn).
- `marketplace_quotes`       — one live quote per shop per van; carries the
                               10% fee owed and the DSP's latest decision.
- `marketplace_quote_lines`  — which offers (defects) a quote covers.
- `approval_tokens`          — DSP's tokenized review link, one per DSP per
                               van. Only the hash (and an HMAC salt) is stored.
- `marketplace_events`       — append-only audit of every offer / quote /
                               decision / email event. `wo_activity_log` has a
                               CHECK-constrained entity allowlist, so the
                               marketplace keeps its own log.
"""

from datetime import datetime
from decimal import Decimal
from enum import Enum, StrEnum
from typing import Any

import sqlalchemy as sa
from sqlalchemy import Column, Index, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now

# Wildcard stored in `marketplace_rules.defect_types` meaning "every defect
# type for this part" (spec §3, Body damage row: "all").
ALL_DEFECT_TYPES = "*"


def _enum_col(name: str, enum_cls: type[Enum], length: int, **kw) -> Column:
    """VARCHAR-backed enum column (CLAUDE.md rule #2)."""
    return Column(
        name,
        sa.Enum(
            enum_cls,
            native_enum=False,
            length=length,
            values_callable=lambda e: [m.value for m in e],
        ),
        **kw,
    )


# ─────────────────────────────────────────────────────────
# Enums (VARCHAR)
# ─────────────────────────────────────────────────────────
class MarketplaceSpecialty(StrEnum):
    """Shop specialty a rule routes to (spec §3, last column)."""

    BODY = "body"
    GENERAL = "general"


class ShopOnboardingStatus(StrEnum):
    """Where a shop is in the marketplace onboarding (spec §8).

    prospect   — org exists, no active users. Gets digests by contact email
                 with a magic link to the board.
    invited    — accepted the Repair Partner terms at its first quote; an
                 invitation was sent through the existing invitation flow.
    registered — org has at least one active user (logs in normally).
    """

    PROSPECT = "prospect"
    INVITED = "invited"
    REGISTERED = "registered"


class OfferState(StrEnum):
    OPEN = "open"
    AWARDED = "awarded"
    WITHDRAWN = "withdrawn"


class QuoteState(StrEnum):
    SUBMITTED = "submitted"
    REVISION_REQUESTED = "revision_requested"
    APPROVED = "approved"
    REJECTED = "rejected"
    NOT_SELECTED = "not_selected"
    WITHDRAWN = "withdrawn"


# Quote states that still compete for the van's offers.
LIVE_QUOTE_STATES: tuple[str, ...] = (
    QuoteState.SUBMITTED.value,
    QuoteState.REVISION_REQUESTED.value,
)


class FeeStatus(StrEnum):
    """DFS 10% coordination fee (spec §6). Phase 1 only ever writes `owed`;
    the other values are reserved for the collection step that comes later
    (no schema change needed then)."""

    OWED = "owed"
    INVOICED = "invoiced"
    PAID = "paid"
    WAIVED = "waived"


class QuoteCloseReason(StrEnum):
    """Why a quote left the live set without a DSP decision on it."""

    SHOP_WITHDREW = "shop_withdrew"
    OFFER_WITHDRAWN = "offer_withdrawn"  # defect routed to a WO elsewhere
    OTHER_QUOTE_APPROVED = "other_quote_approved"


class OfferWithdrawReason(StrEnum):
    ROUTED_TO_WORK_ORDER = "routed_to_work_order"
    DEFECT_DELETED = "defect_deleted"
    NO_LONGER_ELIGIBLE = "no_longer_eligible"  # rule deactivated / changed


# ─────────────────────────────────────────────────────────
# marketplace_rules
# ─────────────────────────────────────────────────────────
class MarketplaceRule(SQLModel, table=True):
    """One row per Nova Fora `part`. Editable by DFS without a deploy."""

    __tablename__ = "marketplace_rules"
    __table_args__ = (UniqueConstraint("part", name="marketplace_rules_part_uq"),)

    id: int | None = Field(default=None, primary_key=True)
    category: str = Field(max_length=40, nullable=False, index=True)
    part: str = Field(max_length=40, nullable=False)
    defect_types: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            "defect_types", ARRAY(sa.String(length=40)), nullable=False, server_default="{}"
        ),
        description="Eligible DefectType values; ['*'] = every type.",
    )
    specialty: MarketplaceSpecialty = Field(
        sa_column=_enum_col("specialty", MarketplaceSpecialty, 20, nullable=False, index=True),
    )
    active: bool = Field(default=True, nullable=False, index=True)

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        return f"MR-{self.id:03d}" if self.id is not None else ""

    def matches(self, defect_type: str) -> bool:
        return ALL_DEFECT_TYPES in (self.defect_types or []) or defect_type in (
            self.defect_types or []
        )


# ─────────────────────────────────────────────────────────
# marketplace_shop_profiles
# ─────────────────────────────────────────────────────────
class MarketplaceShopProfile(SQLModel, table=True):
    """Marketplace-specific data for a `vendor` / `body_repair_vendor` org.

    `Organization` has no email column, so the contact email lives here
    (spec §8). Created lazily by `ensure_shop_profile()` with specialties
    defaulted from the org type.
    """

    __tablename__ = "marketplace_shop_profiles"
    __table_args__ = (UniqueConstraint("organization_id", name="marketplace_shop_profiles_org_uq"),)

    id: int | None = Field(default=None, primary_key=True)
    organization_id: int = Field(
        sa_column=Column(
            "organization_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    contact_email: str | None = Field(default=None, max_length=255)
    # Default Reply-To the shop uses on its quotes (pre-fills the form).
    quote_reply_email: str | None = Field(default=None, max_length=255)
    specialties: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            "specialties", ARRAY(sa.String(length=20)), nullable=False, server_default="{}"
        ),
    )
    onboarding_status: ShopOnboardingStatus = Field(
        default=ShopOnboardingStatus.PROSPECT,
        sa_column=_enum_col(
            "onboarding_status",
            ShopOnboardingStatus,
            20,
            nullable=False,
            index=True,
            server_default=ShopOnboardingStatus.PROSPECT.value,
        ),
    )
    # Opt-out switch: inactive profiles get no digests and see no board.
    is_active: bool = Field(default=True, nullable=False, index=True)

    # DFS Repair Partner terms — accepted by a prospect at its first quote.
    terms_accepted_at: datetime | None = Field(
        default=None,
        sa_column=Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True),
    )
    terms_version: str | None = Field(default=None, max_length=40)
    terms_accepted_email: str | None = Field(default=None, max_length=255)
    terms_accepted_name: str | None = Field(default=None, max_length=200)
    invitation_id: int | None = Field(
        default=None,
        sa_column=Column(
            "invitation_id",
            sa.Integer,
            sa.ForeignKey("invitations.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    # Prospect magic link (board access without a login). Only the SHA-256
    # of the token is stored; the salt lets the server re-derive the same
    # link with its secret for the next digest (see services/marketplace/tokens.py).
    magic_token_hash: str | None = Field(default=None, max_length=64, unique=True)
    magic_token_salt: str | None = Field(default=None, max_length=64)
    magic_token_issued_at: datetime | None = Field(
        default=None,
        sa_column=Column("magic_token_issued_at", sa.DateTime(timezone=True), nullable=True),
    )
    last_digest_at: datetime | None = Field(
        default=None,
        sa_column=Column("last_digest_at", sa.DateTime(timezone=True), nullable=True),
    )

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        return f"MSP-{self.id:04d}" if self.id is not None else ""


# ─────────────────────────────────────────────────────────
# marketplace_offers
# ─────────────────────────────────────────────────────────
class MarketplaceOffer(SQLModel, table=True):
    """One offer per eligible defect.

    Nightly inspections create a NEW `defects` row for the same physical
    damage every night, so offers also carry a `defect_key` — (vehicle,
    part, position, defect_type, wheel_position, damage_seq) — and a partial
    unique index keeps at most one OPEN offer per physical defect.

    Part / type / position / notes are snapshotted so the offer stays
    readable if the defect row is later deleted (FK is SET NULL).
    """

    __tablename__ = "marketplace_offers"
    __table_args__ = (
        Index(
            "uq_marketplace_offers_open_defect_key",
            "defect_key",
            unique=True,
            postgresql_where=sa.text("state = 'open'"),
        ),
        Index(
            "uq_marketplace_offers_live_defect",
            "defect_id",
            unique=True,
            postgresql_where=sa.text("state IN ('open', 'awarded')"),
        ),
    )

    id: int | None = Field(default=None, primary_key=True)
    defect_id: int | None = Field(
        default=None,
        sa_column=Column(
            "defect_id",
            sa.Integer,
            sa.ForeignKey("defects.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    vehicle_id: int = Field(
        sa_column=Column(
            "vehicle_id",
            sa.Integer,
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    dsp_id: int = Field(
        sa_column=Column(
            "dsp_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        description="Denormalized from vehicles.dsp_id — never exposed to shops before award.",
    )
    rule_id: int | None = Field(
        default=None,
        sa_column=Column(
            "rule_id",
            sa.Integer,
            sa.ForeignKey("marketplace_rules.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    specialty: MarketplaceSpecialty = Field(
        sa_column=_enum_col("specialty", MarketplaceSpecialty, 20, nullable=False, index=True),
    )
    station: str | None = Field(default=None, max_length=20, index=True)
    defect_key: str = Field(max_length=200, nullable=False, index=True)

    # Snapshot of the defect at offer time.
    part: str = Field(max_length=40, nullable=False)
    position: str | None = Field(default=None, max_length=30)
    defect_type: str = Field(max_length=40, nullable=False)
    notes: str | None = Field(default=None, max_length=2000)
    reported_at: datetime | None = Field(
        default=None,
        sa_column=Column("reported_at", sa.DateTime(timezone=True), nullable=True),
    )

    state: OfferState = Field(
        default=OfferState.OPEN,
        sa_column=_enum_col(
            "state",
            OfferState,
            20,
            nullable=False,
            index=True,
            server_default=OfferState.OPEN.value,
        ),
    )
    awarded_quote_id: int | None = Field(
        default=None,
        sa_column=Column(
            "awarded_quote_id",
            sa.Integer,
            sa.ForeignKey("marketplace_quotes.id", ondelete="SET NULL", use_alter=True),
            nullable=True,
        ),
    )
    awarded_at: datetime | None = Field(
        default=None,
        sa_column=Column("awarded_at", sa.DateTime(timezone=True), nullable=True),
    )
    withdrawn_at: datetime | None = Field(
        default=None,
        sa_column=Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
    )
    withdrawn_reason: str | None = Field(default=None, max_length=40)
    # Set when the offer went out in a daily digest (spec §5: once, the day
    # it is created).
    digested_at: datetime | None = Field(
        default=None,
        sa_column=Column("digested_at", sa.DateTime(timezone=True), nullable=True, index=True),
    )

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        return f"MO-{self.id:05d}" if self.id is not None else ""


# ─────────────────────────────────────────────────────────
# marketplace_quotes
# ─────────────────────────────────────────────────────────
class MarketplaceQuote(SQLModel, table=True):
    """A shop's price for one or more open offers on ONE van.

    One live quote (submitted / revision_requested) per shop per van —
    enforced by a partial unique index. To change the price the shop
    revises; a new quote is only possible once the old one left the live
    set (rejected / not_selected / withdrawn).
    """

    __tablename__ = "marketplace_quotes"
    __table_args__ = (
        Index(
            "uq_marketplace_quotes_live_shop_van",
            "shop_org_id",
            "vehicle_id",
            unique=True,
            postgresql_where=sa.text("state IN ('submitted', 'revision_requested')"),
        ),
        sa.CheckConstraint("total_amount > 0", name="marketplace_quotes_total_positive"),
    )

    id: int | None = Field(default=None, primary_key=True)
    shop_org_id: int = Field(
        sa_column=Column(
            "shop_org_id",
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
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    dsp_id: int = Field(
        sa_column=Column(
            "dsp_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    state: QuoteState = Field(
        default=QuoteState.SUBMITTED,
        sa_column=_enum_col(
            "state",
            QuoteState,
            30,
            nullable=False,
            index=True,
            server_default=QuoteState.SUBMITTED.value,
        ),
    )
    revision: int = Field(default=1, nullable=False)

    # ── Money (spec §6) ──
    total_amount: Decimal = Field(sa_column=Column("total_amount", Numeric(10, 2), nullable=False))
    fee_rate: Decimal = Field(sa_column=Column("fee_rate", Numeric(5, 4), nullable=False))
    fee_amount: Decimal = Field(sa_column=Column("fee_amount", Numeric(10, 2), nullable=False))
    # NULL until approval; `owed` once the DSP approves. Collection is a
    # later phase.
    fee_status: FeeStatus | None = Field(
        default=None,
        sa_column=_enum_col("fee_status", FeeStatus, 20, nullable=True, index=True),
    )

    # ── Shop side ──
    reply_to_email: str = Field(max_length=255, nullable=False)
    notes: str | None = Field(default=None, max_length=2000)
    submitted_by_id: int | None = Field(
        default=None,
        sa_column=Column(
            "submitted_by_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        description="NULL when a prospect quoted through its magic link.",
    )
    submitted_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
    )

    # ── DSP decision (latest one; full history in marketplace_events) ──
    decision: str | None = Field(default=None, max_length=30)
    decision_note: str | None = Field(default=None, max_length=2000)
    decided_at: datetime | None = Field(
        default=None,
        sa_column=Column("decided_at", sa.DateTime(timezone=True), nullable=True),
    )
    decided_via_token_id: int | None = Field(
        default=None,
        sa_column=Column(
            "decided_via_token_id",
            sa.Integer,
            sa.ForeignKey("approval_tokens.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    closed_reason: str | None = Field(default=None, max_length=40)
    closed_at: datetime | None = Field(
        default=None,
        sa_column=Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── Work created on approval ──
    repair_request_id: int | None = Field(
        default=None,
        sa_column=Column(
            "repair_request_id",
            sa.Integer,
            sa.ForeignKey("repair_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    work_order_id: int | None = Field(
        default=None,
        sa_column=Column(
            "work_order_id",
            sa.Integer,
            sa.ForeignKey("work_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    body_repair_request_id: int | None = Field(
        default=None,
        sa_column=Column(
            "body_repair_request_id",
            sa.Integer,
            sa.ForeignKey("body_repair_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        return f"MQ-{self.id:05d}" if self.id is not None else ""

    @property
    def is_live(self) -> bool:
        state = self.state.value if hasattr(self.state, "value") else str(self.state)
        return state in LIVE_QUOTE_STATES


class MarketplaceQuoteLine(SQLModel, table=True):
    """One offer (defect) covered by a quote. `amount` is optional: the
    pilot priced per van, so a quote may carry only a total."""

    __tablename__ = "marketplace_quote_lines"
    __table_args__ = (
        UniqueConstraint("quote_id", "offer_id", name="marketplace_quote_lines_quote_offer_uq"),
    )

    id: int | None = Field(default=None, primary_key=True)
    quote_id: int = Field(
        sa_column=Column(
            "quote_id",
            sa.Integer,
            sa.ForeignKey("marketplace_quotes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    offer_id: int = Field(
        sa_column=Column(
            "offer_id",
            sa.Integer,
            sa.ForeignKey("marketplace_offers.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    amount: Decimal | None = Field(
        default=None, sa_column=Column("amount", Numeric(10, 2), nullable=True)
    )
    note: str | None = Field(default=None, max_length=500)

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))

    @property
    def id_str(self) -> str:
        return f"MQL-{self.id:05d}" if self.id is not None else ""


# ─────────────────────────────────────────────────────────
# approval_tokens
# ─────────────────────────────────────────────────────────
class ApprovalToken(SQLModel, table=True):
    """DSP review link for one van — one row per (DSP, van).

    The raw token is never stored: `token_hash` is SHA-256 of the token and
    the token itself is HMAC(secret, salt). Every quote email for the van
    re-derives the same link, so older emails keep working. The token is
    "used up" once the van has no open offers left; if new offers appear
    later the salt is rotated and old links stay dead.
    """

    __tablename__ = "approval_tokens"
    __table_args__ = (
        UniqueConstraint("dsp_id", "vehicle_id", name="approval_tokens_dsp_vehicle_uq"),
    )

    id: int | None = Field(default=None, primary_key=True)
    dsp_id: int = Field(
        sa_column=Column(
            "dsp_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    vehicle_id: int = Field(
        sa_column=Column(
            "vehicle_id",
            sa.Integer,
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    token_hash: str = Field(max_length=64, nullable=False, unique=True)
    token_salt: str = Field(max_length=64, nullable=False)
    issued_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column("issued_at", sa.DateTime(timezone=True), nullable=False),
    )
    exhausted_at: datetime | None = Field(
        default=None,
        sa_column=Column("exhausted_at", sa.DateTime(timezone=True), nullable=True),
    )
    revoked_at: datetime | None = Field(
        default=None,
        sa_column=Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    last_used_at: datetime | None = Field(
        default=None,
        sa_column=Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )

    created_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("created_at"))
    updated_at: datetime = Field(default_factory=utc_now, sa_column=timestamp_column("updated_at"))

    @property
    def id_str(self) -> str:
        return f"MAT-{self.id:05d}" if self.id is not None else ""


# ─────────────────────────────────────────────────────────
# marketplace_events
# ─────────────────────────────────────────────────────────
class MarketplaceEvent(SQLModel, table=True):
    """Append-only audit trail (spec §9: every decision with time + note)."""

    __tablename__ = "marketplace_events"

    id: int | None = Field(default=None, primary_key=True)
    event: str = Field(max_length=40, nullable=False, index=True)
    offer_id: int | None = Field(
        default=None,
        sa_column=Column(
            "offer_id",
            sa.Integer,
            sa.ForeignKey("marketplace_offers.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    quote_id: int | None = Field(
        default=None,
        sa_column=Column(
            "quote_id",
            sa.Integer,
            sa.ForeignKey("marketplace_quotes.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
    )
    vehicle_id: int | None = Field(default=None, index=True)
    shop_org_id: int | None = Field(default=None, index=True)
    # 'shop_user' | 'prospect' | 'dsp_token' | 'system' | 'admin'
    actor_kind: str = Field(max_length=20, nullable=False)
    actor_user_id: int | None = Field(
        default=None,
        sa_column=Column(
            "actor_user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    note: str | None = Field(default=None, max_length=2000)
    details: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column("details", JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
            index=True,
        ),
    )
