"""DSP settings endpoints — per-DSP config (preauth groups, SLA, window, …).

Keyed by `dsp_id` (organizations.id). One row per DSP; missing row = use
platform defaults (review_sla=24h, bundling_window=30min, variance=10%,
no preauth groups, no cmr threshold).

Authorization:
  - site_admin: full CRUD across all DSPs
  - dsp_owner: read + write their own org's row only
  - vendor_admin / technician: no access (settings are tenant-private)

PATCH semantics: upsert. If no row exists for the dsp_id, we create one;
otherwise patch the fields the body supplies.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.i18n_errors import E, tr_error
from app.i18n_helpers import get_request_language
from app.models.organization import OrgType, Organization
from app.models.user import User, UserRole
from app.models.work_orders import DspSetting

router = APIRouter(prefix="/dsp-settings", tags=["dsp-settings"])


# ─────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────
class DspSettingResponse(BaseModel):
    dsp_id: int
    cmr_auto_approve_threshold: Decimal | None = None
    preauth_defect_groups: list[str]
    notes: str | None = None
    review_sla_hours: int
    default_variance_tolerance: Decimal
    bundling_window_minutes: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_model(cls, s: DspSetting) -> "DspSettingResponse":
        return cls(
            dsp_id=s.dsp_id,
            cmr_auto_approve_threshold=s.cmr_auto_approve_threshold,
            preauth_defect_groups=list(s.preauth_defect_groups or []),
            notes=s.notes,
            review_sla_hours=s.review_sla_hours,
            default_variance_tolerance=s.default_variance_tolerance,
            bundling_window_minutes=s.bundling_window_minutes,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )

    @classmethod
    def default_for(cls, dsp_id: int) -> "DspSettingResponse":
        """Return platform defaults when no row exists yet."""
        now = datetime.now()
        return cls(
            dsp_id=dsp_id,
            cmr_auto_approve_threshold=None,
            preauth_defect_groups=[],
            notes=None,
            review_sla_hours=24,
            default_variance_tolerance=Decimal("0.10"),
            bundling_window_minutes=30,
            created_at=now,
            updated_at=now,
        )


class DspSettingUpdate(BaseModel):
    cmr_auto_approve_threshold: Decimal | None = Field(default=None, ge=0)
    preauth_defect_groups: list[str] | None = None
    notes: str | None = None
    review_sla_hours: int | None = Field(default=None, ge=1, le=24 * 30)
    default_variance_tolerance: Decimal | None = Field(default=None, ge=0, le=10)
    bundling_window_minutes: int | None = Field(default=None, ge=0, le=24 * 60)

    model_config = ConfigDict(extra="forbid")


def _can_access_dsp(user: User, dsp_id: int) -> bool:
    if user.role == UserRole.SITE_ADMIN:
        return True
    if user.role == UserRole.DSP_OWNER and user.organization_id == dsp_id:
        return True
    return False


async def _require_dsp_exists(session: AsyncSession, dsp_id: int, lang: str) -> None:
    org = (
        await session.execute(
            select(Organization)
            .where(Organization.id == dsp_id)
            .where(Organization.org_type == OrgType.DSP)
        )
    ).scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, tr_error(E.ORG_NOT_FOUND, lang)
        )


# ─────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────
@router.get(
    "/{dsp_id}",
    response_model=DspSettingResponse,
    summary="Get settings for a DSP (returns platform defaults if none stored)",
)
async def get_dsp_settings(
    request: Request,
    dsp_id: int = Path(..., examples=[1]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DspSettingResponse:
    lang = get_request_language(request)
    if not _can_access_dsp(current, dsp_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_DSP, lang)
        )
    await _require_dsp_exists(session, dsp_id, lang)
    row = (
        await session.execute(select(DspSetting).where(DspSetting.dsp_id == dsp_id))
    ).scalar_one_or_none()
    if row is None:
        return DspSettingResponse.default_for(dsp_id)
    return DspSettingResponse.from_model(row)


@router.patch(
    "/{dsp_id}",
    response_model=DspSettingResponse,
    summary="Upsert DSP settings (creates the row if missing)",
)
async def upsert_dsp_settings(
    body: DspSettingUpdate,
    request: Request,
    dsp_id: int = Path(..., examples=[1]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> DspSettingResponse:
    lang = get_request_language(request)
    if not _can_access_dsp(current, dsp_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, tr_error(E.NOT_YOUR_DSP, lang)
        )
    await _require_dsp_exists(session, dsp_id, lang)
    row = (
        await session.execute(select(DspSetting).where(DspSetting.dsp_id == dsp_id))
    ).scalar_one_or_none()
    if row is None:
        # Insert with platform defaults overridden by body fields
        row = DspSetting(dsp_id=dsp_id)
        session.add(row)
    if body.cmr_auto_approve_threshold is not None:
        row.cmr_auto_approve_threshold = body.cmr_auto_approve_threshold
    if body.preauth_defect_groups is not None:
        row.preauth_defect_groups = list(body.preauth_defect_groups)
    if body.notes is not None:
        row.notes = body.notes
    if body.review_sla_hours is not None:
        row.review_sla_hours = body.review_sla_hours
    if body.default_variance_tolerance is not None:
        row.default_variance_tolerance = body.default_variance_tolerance
    if body.bundling_window_minutes is not None:
        row.bundling_window_minutes = body.bundling_window_minutes
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return DspSettingResponse.from_model(row)
