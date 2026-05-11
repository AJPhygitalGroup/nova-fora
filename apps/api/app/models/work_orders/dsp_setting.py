"""DspSetting — per-DSP config (the spec's `customer_settings`).

Keyed by `dsp_id` (FK to organizations.id) rather than the spec's text
`customer_org_name` PK — we already have the master Organization table.
One row per DSP; missing row = use platform defaults at the app layer.

Defaults match the spec:
  - review_sla_hours = 24      (max time a defect can wait for scope approval)
  - bundling_window_minutes = 30 (how long to wait for sibling defects to
                                  bundle into the same RR after approval)
  - default_variance_tolerance = 0.10  (10% — over this, variance reapproval
                                        kicks in; DORMANT in v2.0)
  - cmr_auto_approve_threshold = NULL  (no auto-approve; everything pings the
                                         customer once cost-approval flow lights
                                         up in v2.x; DORMANT in v2.0)

`preauth_defect_groups` carries defect-group values from the V2.2 defect
schema; defects in those groups skip manual review (decision_method =
'auto_preauth_group' on the defect_review row).
"""
from datetime import datetime
from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class DspSetting(SQLModel, table=True):
    __tablename__ = "dsp_settings"

    dsp_id: int = Field(
        sa_column=Column(
            "dsp_id",
            sa.Integer,
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )
    cmr_auto_approve_threshold: Decimal | None = Field(
        default=None,
        sa_column=Column("cmr_auto_approve_threshold", sa.Numeric(10, 2), nullable=True),
        description="DORMANT in v2.0. Future: auto-approve any CMR estimate ≤ this.",
    )
    preauth_defect_groups: list[str] = Field(
        default_factory=list,
        sa_column=Column(
            "preauth_defect_groups",
            ARRAY(sa.String(length=30)),
            nullable=False,
            server_default="{}",
        ),
    )
    notes: str | None = Field(default=None)
    review_sla_hours: int = Field(default=24, nullable=False)
    default_variance_tolerance: Decimal = Field(
        default=Decimal("0.10"),
        sa_column=Column(
            "default_variance_tolerance",
            sa.Numeric,
            nullable=False,
            server_default="0.10",
        ),
        description="Signed positive fraction (e.g. 0.10 = 10%) above which "
                    "variance reapproval triggers. DORMANT in v2.0 (log-only).",
    )
    bundling_window_minutes: int = Field(default=30, nullable=False)

    created_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("created_at")
    )
    updated_at: datetime = Field(
        default_factory=utc_now, sa_column=timestamp_column("updated_at")
    )
