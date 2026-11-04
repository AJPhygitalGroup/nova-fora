"""DFS CMR repair marketplace — Phase 1 tables + rule seed

Adds the seven marketplace tables (rules, shop profiles, offers, quotes,
quote lines, approval tokens, events) and seeds `marketplace_rules`
exactly from spec §3 (confirmed by Jorge, Nov 4 2026).

The seed below is a frozen snapshot on purpose — migrations must not
import app code that can change later. `app/services/marketplace/rules.py`
keeps the same table as `RULE_SEED` (a test asserts they match) for the
`seed-marketplace-rules` CLI.

Revision ID: 20261104_1200
Revises: 20260607_2000
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

from alembic import op

revision = "20261104_1200"
down_revision = "20260607_2000"
branch_labels = None
depends_on = None


_PANEL_TYPES = [
    "damaged",
    "cracked",
    "broken",
    "bent",
    "dent",
    "scratch",
    "paint_chip",
    "missing",
    "hanging",
    "loose",
    "other_damage",
]
_GLASS_TYPES = ["cracked", "broken", "damaged", "missing", "other_damage"]
_LIGHT_TYPES = [
    "cracked",
    "broken",
    "cover_cracked",
    "cover_missing",
    "damaged",
    "missing",
    "hanging",
]
_STEP_TYPES = ["damaged", "cracked", "broken", "bent", "loose", "hanging", "missing"]
_MIRROR_TYPES = ["damaged", "cracked", "broken", "loose", "hanging", "missing", "mount_damaged"]

# (category, parts, defect_types, specialty)
_RULE_SEED = [
    ("body_damage", ["body_damage"], ["*"], "body"),
    (
        "body_panels",
        [
            "bumper",
            "fender",
            "hood",
            "side_panel",
            "side_molding",
            "trim",
            "exterior_door",
            "sliding_side_door",
            "rear_cargo_door",
            "cab_door",
        ],
        _PANEL_TYPES,
        "body",
    ),
    ("glass", ["windshield", "window"], _GLASS_TYPES, "body"),
    (
        "lights",
        [
            "headlight",
            "tail_light",
            "turn_signal",
            "hazard_light",
            "marker_light",
            "clearance_marker_light",
            "license_plate_light",
            "mirror_light",
            "cargo_light",
            "cabin_light",
            "stepwell_light",
        ],
        _LIGHT_TYPES,
        "general",
    ),
    ("steps", ["side_step", "rear_step"], _STEP_TYPES, "general"),
    ("mirrors", ["side_mirror"], _MIRROR_TYPES, "general"),
]


def _ts(name: str, nullable: bool = True) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=nullable)


def _created_updated() -> list[sa.Column]:
    return [
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
    ]


def upgrade() -> None:
    # ── marketplace_rules ─────────────────────────────────
    op.create_table(
        "marketplace_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("part", sa.String(length=40), nullable=False),
        sa.Column(
            "defect_types",
            ARRAY(sa.String(length=40)),
            nullable=False,
            server_default="{}",
        ),
        sa.Column("specialty", sa.String(length=20), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
        *_created_updated(),
        sa.UniqueConstraint("part", name="marketplace_rules_part_uq"),
        sa.CheckConstraint(
            "specialty IN ('body', 'general')", name="marketplace_rules_specialty_chk"
        ),
    )
    op.create_index("ix_marketplace_rules_category", "marketplace_rules", ["category"])
    op.create_index("ix_marketplace_rules_specialty", "marketplace_rules", ["specialty"])
    op.create_index("ix_marketplace_rules_active", "marketplace_rules", ["active"])

    rules_t = sa.table(
        "marketplace_rules",
        sa.column("category", sa.String),
        sa.column("part", sa.String),
        sa.column("defect_types", ARRAY(sa.String)),
        sa.column("specialty", sa.String),
        sa.column("active", sa.Boolean),
    )
    op.bulk_insert(
        rules_t,
        [
            {
                "category": category,
                "part": part,
                "defect_types": list(types),
                "specialty": specialty,
                "active": True,
            }
            for (category, parts, types, specialty) in _RULE_SEED
            for part in parts
        ],
    )

    # ── marketplace_shop_profiles ─────────────────────────
    op.create_table(
        "marketplace_shop_profiles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "organization_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("contact_email", sa.String(length=255), nullable=True),
        sa.Column("quote_reply_email", sa.String(length=255), nullable=True),
        sa.Column("specialties", ARRAY(sa.String(length=20)), nullable=False, server_default="{}"),
        sa.Column(
            "onboarding_status",
            sa.String(length=20),
            nullable=False,
            server_default="prospect",
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        _ts("terms_accepted_at"),
        sa.Column("terms_version", sa.String(length=40), nullable=True),
        sa.Column("terms_accepted_email", sa.String(length=255), nullable=True),
        sa.Column("terms_accepted_name", sa.String(length=200), nullable=True),
        sa.Column(
            "invitation_id",
            sa.Integer(),
            sa.ForeignKey("invitations.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("magic_token_hash", sa.String(length=64), nullable=True),
        sa.Column("magic_token_salt", sa.String(length=64), nullable=True),
        _ts("magic_token_issued_at"),
        _ts("last_digest_at"),
        *_created_updated(),
        sa.UniqueConstraint("organization_id", name="marketplace_shop_profiles_org_uq"),
        sa.UniqueConstraint(
            "magic_token_hash", name="marketplace_shop_profiles_magic_token_hash_key"
        ),
        sa.CheckConstraint(
            "onboarding_status IN ('prospect', 'invited', 'registered')",
            name="marketplace_shop_profiles_onboarding_chk",
        ),
    )
    op.create_index(
        "ix_marketplace_shop_profiles_onboarding_status",
        "marketplace_shop_profiles",
        ["onboarding_status"],
    )
    op.create_index(
        "ix_marketplace_shop_profiles_is_active", "marketplace_shop_profiles", ["is_active"]
    )

    # ── approval_tokens ───────────────────────────────────
    op.create_table(
        "approval_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "dsp_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("token_salt", sa.String(length=64), nullable=False),
        _ts("issued_at", nullable=False),
        _ts("exhausted_at"),
        _ts("revoked_at"),
        _ts("last_used_at"),
        *_created_updated(),
        sa.UniqueConstraint("dsp_id", "vehicle_id", name="approval_tokens_dsp_vehicle_uq"),
        sa.UniqueConstraint("token_hash", name="approval_tokens_token_hash_key"),
    )
    op.create_index("ix_approval_tokens_dsp_id", "approval_tokens", ["dsp_id"])
    op.create_index("ix_approval_tokens_vehicle_id", "approval_tokens", ["vehicle_id"])

    # ── marketplace_offers ────────────────────────────────
    # awarded_quote_id's FK is added after marketplace_quotes exists.
    op.create_table(
        "marketplace_offers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "defect_id",
            sa.Integer(),
            sa.ForeignKey("defects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dsp_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "rule_id",
            sa.Integer(),
            sa.ForeignKey("marketplace_rules.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("specialty", sa.String(length=20), nullable=False),
        sa.Column("station", sa.String(length=20), nullable=True),
        sa.Column("defect_key", sa.String(length=200), nullable=False),
        sa.Column("part", sa.String(length=40), nullable=False),
        sa.Column("position", sa.String(length=30), nullable=True),
        sa.Column("defect_type", sa.String(length=40), nullable=False),
        sa.Column("notes", sa.String(length=2000), nullable=True),
        _ts("reported_at"),
        sa.Column("state", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("awarded_quote_id", sa.Integer(), nullable=True),
        _ts("awarded_at"),
        _ts("withdrawn_at"),
        sa.Column("withdrawn_reason", sa.String(length=40), nullable=True),
        _ts("digested_at"),
        *_created_updated(),
        sa.CheckConstraint(
            "state IN ('open', 'awarded', 'withdrawn')", name="marketplace_offers_state_chk"
        ),
    )
    for col in (
        "defect_id",
        "vehicle_id",
        "dsp_id",
        "specialty",
        "station",
        "defect_key",
        "state",
        "digested_at",
    ):
        op.create_index(f"ix_marketplace_offers_{col}", "marketplace_offers", [col])
    op.create_index(
        "uq_marketplace_offers_open_defect_key",
        "marketplace_offers",
        ["defect_key"],
        unique=True,
        postgresql_where=sa.text("state = 'open'"),
    )
    op.create_index(
        "uq_marketplace_offers_live_defect",
        "marketplace_offers",
        ["defect_id"],
        unique=True,
        postgresql_where=sa.text("state IN ('open', 'awarded')"),
    )

    # ── marketplace_quotes ────────────────────────────────
    op.create_table(
        "marketplace_quotes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "shop_org_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "vehicle_id",
            sa.Integer(),
            sa.ForeignKey("vehicles.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "dsp_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state", sa.String(length=30), nullable=False, server_default="submitted"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("total_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("fee_rate", sa.Numeric(5, 4), nullable=False),
        sa.Column("fee_amount", sa.Numeric(10, 2), nullable=False),
        sa.Column("fee_status", sa.String(length=20), nullable=True),
        sa.Column("reply_to_email", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.String(length=2000), nullable=True),
        sa.Column(
            "submitted_by_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        _ts("submitted_at", nullable=False),
        sa.Column("decision", sa.String(length=30), nullable=True),
        sa.Column("decision_note", sa.String(length=2000), nullable=True),
        _ts("decided_at"),
        sa.Column(
            "decided_via_token_id",
            sa.Integer(),
            sa.ForeignKey("approval_tokens.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("closed_reason", sa.String(length=40), nullable=True),
        _ts("closed_at"),
        sa.Column(
            "repair_request_id",
            sa.Integer(),
            sa.ForeignKey("repair_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "work_order_id",
            sa.Integer(),
            sa.ForeignKey("work_orders.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "body_repair_request_id",
            sa.Integer(),
            sa.ForeignKey("body_repair_requests.id", ondelete="SET NULL"),
            nullable=True,
        ),
        *_created_updated(),
        sa.CheckConstraint("total_amount > 0", name="marketplace_quotes_total_positive"),
        sa.CheckConstraint(
            "state IN ('submitted', 'revision_requested', 'approved', 'rejected', "
            "'not_selected', 'withdrawn')",
            name="marketplace_quotes_state_chk",
        ),
        sa.CheckConstraint(
            "fee_status IS NULL OR fee_status IN ('owed', 'invoiced', 'paid', 'waived')",
            name="marketplace_quotes_fee_status_chk",
        ),
    )
    for col in ("shop_org_id", "vehicle_id", "dsp_id", "state", "fee_status"):
        op.create_index(f"ix_marketplace_quotes_{col}", "marketplace_quotes", [col])
    op.create_index(
        "uq_marketplace_quotes_live_shop_van",
        "marketplace_quotes",
        ["shop_org_id", "vehicle_id"],
        unique=True,
        postgresql_where=sa.text("state IN ('submitted', 'revision_requested')"),
    )
    op.create_foreign_key(
        "marketplace_offers_awarded_quote_id_fkey",
        "marketplace_offers",
        "marketplace_quotes",
        ["awarded_quote_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # ── marketplace_quote_lines ───────────────────────────
    op.create_table(
        "marketplace_quote_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "quote_id",
            sa.Integer(),
            sa.ForeignKey("marketplace_quotes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "offer_id",
            sa.Integer(),
            sa.ForeignKey("marketplace_offers.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(10, 2), nullable=True),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint("quote_id", "offer_id", name="marketplace_quote_lines_quote_offer_uq"),
        sa.CheckConstraint(
            "amount IS NULL OR amount > 0", name="marketplace_quote_lines_amount_positive"
        ),
    )
    op.create_index("ix_marketplace_quote_lines_quote_id", "marketplace_quote_lines", ["quote_id"])
    op.create_index("ix_marketplace_quote_lines_offer_id", "marketplace_quote_lines", ["offer_id"])

    # ── marketplace_events ────────────────────────────────
    op.create_table(
        "marketplace_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event", sa.String(length=40), nullable=False),
        sa.Column(
            "offer_id",
            sa.Integer(),
            sa.ForeignKey("marketplace_offers.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "quote_id",
            sa.Integer(),
            sa.ForeignKey("marketplace_quotes.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("vehicle_id", sa.Integer(), nullable=True),
        sa.Column("shop_org_id", sa.Integer(), nullable=True),
        sa.Column("actor_kind", sa.String(length=20), nullable=False),
        sa.Column(
            "actor_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("note", sa.String(length=2000), nullable=True),
        sa.Column("details", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    for col in ("event", "offer_id", "quote_id", "vehicle_id", "shop_org_id", "created_at"):
        op.create_index(f"ix_marketplace_events_{col}", "marketplace_events", [col])


def downgrade() -> None:
    op.drop_table("marketplace_events")
    op.drop_table("marketplace_quote_lines")
    op.drop_constraint(
        "marketplace_offers_awarded_quote_id_fkey", "marketplace_offers", type_="foreignkey"
    )
    op.drop_table("marketplace_quotes")
    op.drop_table("marketplace_offers")
    op.drop_table("approval_tokens")
    op.drop_table("marketplace_shop_profiles")
    op.drop_table("marketplace_rules")
