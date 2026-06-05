"""Body Repair routes — port of web-mbk-body-repair-demo.

Phase 0 endpoints (this commit):
  POST /body-repair/requests        — customer submits a new request
  GET  /body-repair/requests        — list scoped to caller's role

Phase 1+ will add: PAVE upload, vendor queue, quote submission/selection,
pickup proposal, repair lifecycle, completion + photo capture, messages,
activity timeline.

Tenancy:
  - dsp_owner: only their own DSP's requests (filtered to user.org_id)
  - body_repair_vendor_admin: requests assigned to their org OR
    everything in pending_quotes (open for bidding)
  - site_admin: everything
  - vendor (regular mech): no access (403)

The body repair flow is independent from WO V2 — different lifecycle,
different role surfaces, different vendor org type. We don't try to
shoehorn it into the WorkOrder schema.
"""

from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.base import utc_now
from app.models.body_repair import (
    BodyRepairPaveReport,
    BodyRepairQuote,
    BodyRepairQuoteLineItem,
    BodyRepairQuoteStatus,
    BodyRepairRequest,
    BodyRepairRequestStatus,
    BodyRepairSubmissionMode,
    PaveParseStatus,
    PavePhase,
)
from app.models.organization import Organization, OrgType
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle

router = APIRouter(prefix="/body-repair", tags=["body-repair"])


# ─────────────────────────────────────────────────────
# Request/Response shapes
# ─────────────────────────────────────────────────────
class _PickedComponent(BaseModel):
    """One row in the parts-picker payload — identifies a component
    selected from the parsed PAVE damage list."""

    item_no: int = Field(..., ge=0)
    component_name: str | None = Field(default=None, max_length=200)


class _RequestIssue(BaseModel):
    """One free-text issue from the repeating Notes section. Photo is
    optional and references an already-uploaded storage_key."""

    description: str = Field(..., min_length=1, max_length=2000)
    photo_storage_key: str | None = Field(default=None, max_length=500)


class CreateRequestBody(BaseModel):
    """Customer submission payload — all 3 demo modes.

    text  : free-form description (legacy single-shot or via `issues`
            list for the repeating-Notes UI).
    parts : customer picked specific damages from the parsed PAVE.
            `picked_components` carries the item_no list.
    grade : customer named a target Fleet Condition Grade. Backend
            computes which items must be addressed to reach it
            (Phase 2c-1 — for now just stored verbatim).
    """

    vehicle_id: int = Field(..., gt=0, description="int id of the vehicle the customer wants repaired")
    mode: BodyRepairSubmissionMode = Field(default=BodyRepairSubmissionMode.TEXT)
    text_description: str | None = Field(default=None, max_length=2000)
    issues: list[_RequestIssue] = Field(default_factory=list, max_length=20)
    picked_components: list[_PickedComponent] = Field(default_factory=list, max_length=100)
    target_grade: int | None = Field(default=None, ge=2, le=5)

    model_config = ConfigDict(extra="forbid")


class BodyRepairRequestResponse(BaseModel):
    """Wire shape — mirrors mockData conventions (prefixed ids, ISO
    timestamps). camelCase happens via keysToCamel on the frontend."""

    id: str
    dsp_id: str
    vehicle_id: str
    assigned_vendor_id: str | None
    submission_mode: str
    text_description: str | None
    target_grade: str | None = None
    # Combined "parts + issues" blob — frontend reads .pickedComponents
    # and .issues. None when the customer used text mode without any
    # repeating issues.
    scope_blob: dict | None = None
    status: str
    selected_quote_id: int | None
    quote_selected_at: datetime | None
    pickup_proposed_at: datetime | None
    pickup_confirmed_at: datetime | None
    picked_up_at: datetime | None
    repair_started_at: datetime | None
    repair_completed_at: datetime | None
    returned_at: datetime | None
    paid_at: datetime | None
    created_at: datetime
    updated_at: datetime
    # Denormalized for the list view — saves an N+1 on every render.
    vehicle_fleet_id: str | None = None
    vehicle_year: int | None = None
    vehicle_make: str | None = None
    vehicle_model: str | None = None
    dsp_name: str | None = None
    vendor_name: str | None = None

    model_config = ConfigDict(from_attributes=True)


class BodyRepairRequestListResponse(BaseModel):
    items: list[BodyRepairRequestResponse]
    total: int


# ─────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────
async def _build_response(
    session: AsyncSession, req: BodyRepairRequest
) -> BodyRepairRequestResponse:
    """Denormalize vehicle + org names for the wire response."""
    veh = (await session.execute(select(Vehicle).where(Vehicle.id == req.vehicle_id))).scalar_one_or_none()
    dsp = (await session.execute(select(Organization).where(Organization.id == req.dsp_id))).scalar_one_or_none()
    vendor = None
    if req.assigned_vendor_id is not None:
        vendor = (
            await session.execute(
                select(Organization).where(Organization.id == req.assigned_vendor_id)
            )
        ).scalar_one_or_none()
    return BodyRepairRequestResponse(
        id=req.id_str,
        dsp_id=dsp.id_str if dsp else f"DSP-{req.dsp_id:04d}",
        vehicle_id=veh.id_str if veh else f"VAN-{req.vehicle_id:04d}",
        assigned_vendor_id=(vendor.id_str if vendor else None),
        submission_mode=req.submission_mode.value if hasattr(req.submission_mode, "value") else req.submission_mode,
        text_description=req.text_description,
        target_grade=req.target_grade,
        scope_blob=req.picked_components_json,
        status=req.status.value if hasattr(req.status, "value") else req.status,
        selected_quote_id=req.selected_quote_id,
        quote_selected_at=req.quote_selected_at,
        pickup_proposed_at=req.pickup_proposed_at,
        pickup_confirmed_at=req.pickup_confirmed_at,
        picked_up_at=req.picked_up_at,
        repair_started_at=req.repair_started_at,
        repair_completed_at=req.repair_completed_at,
        returned_at=req.returned_at,
        paid_at=req.paid_at,
        created_at=req.created_at,
        updated_at=req.updated_at,
        vehicle_fleet_id=veh.fleet_id if veh else None,
        vehicle_year=veh.year if veh else None,
        vehicle_make=veh.make if veh else None,
        vehicle_model=veh.model if veh else None,
        dsp_name=dsp.name if dsp else None,
        vendor_name=vendor.name if vendor else None,
    )


# ─────────────────────────────────────────────────────
# POST /body-repair/requests — customer creates new request
# ─────────────────────────────────────────────────────
@router.post(
    "/requests",
    response_model=BodyRepairRequestResponse,
    summary="Customer submits a new body repair request (Phase 0: text mode only)",
    responses={
        400: {"description": "Validation failure (e.g. text mode requires text_description)."},
        403: {"description": "Caller is not a DSP owner or site admin."},
        404: {"description": "Vehicle not found OR belongs to a different DSP."},
    },
)
async def create_request(
    body: CreateRequestBody,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BodyRepairRequestResponse:
    """Customer-side entry into the body repair flow.

    Phase 0 scope: text mode only — customer types a free-form
    description of what they want fixed. The submission lands in
    `pending_quotes` state, ready for vendor pickup in Phase 2.

    Auth: dsp_owner of the vehicle's DSP, OR site_admin (for support /
    impersonation). Cross-DSP create is blocked at the vehicle lookup.
    """
    # Auth gate — only the customer (DSP owner) or site_admin can
    # create requests. Body repair vendors can't create on behalf of
    # the customer in Phase 0.
    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "only dsp_owner or site_admin can submit body repair requests",
        )

    # Mode-specific validation.
    text_payload: str | None = None
    issues_payload: list[dict] = []
    picked_components_payload: list[dict] | None = None
    target_grade_payload: str | None = None

    if body.mode == BodyRepairSubmissionMode.TEXT:
        # Accept either a single text_description OR the repeating
        # issues list (or both — issues take precedence). Mirrors the
        # demo's "A · Notes" section.
        if body.issues:
            issues_payload = [
                {
                    "description": it.description.strip(),
                    "photo_storage_key": it.photo_storage_key,
                }
                for it in body.issues
                if it.description and it.description.strip()
            ]
            if not issues_payload and not (body.text_description and body.text_description.strip()):
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "text mode requires at least one non-empty issue or text_description",
                )
        elif not (body.text_description and body.text_description.strip()):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "text_description is required when mode='text'",
            )
        text_payload = (body.text_description or "").strip() or None
    elif body.mode == BodyRepairSubmissionMode.PARTS:
        if not body.picked_components:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "parts mode requires at least one picked component",
            )
        picked_components_payload = [
            {"item_no": p.item_no, "component_name": p.component_name}
            for p in body.picked_components
        ]
        # Free-text + issues still allowed alongside parts.
        text_payload = (body.text_description or "").strip() or None
        if body.issues:
            issues_payload = [
                {"description": it.description.strip(), "photo_storage_key": it.photo_storage_key}
                for it in body.issues if it.description and it.description.strip()
            ]
    elif body.mode == BodyRepairSubmissionMode.GRADE:
        if body.target_grade is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "grade mode requires target_grade (2-5)",
            )
        # Map int grade → label for the column (the schema stores str
        # for future extensibility: 'mint' / 'excellent' / etc.).
        from app.services.fca_scoring import grade_label as _gl
        target_grade_payload = _gl(body.target_grade) or str(body.target_grade)
        text_payload = (body.text_description or "").strip() or None
        if body.issues:
            issues_payload = [
                {"description": it.description.strip(), "photo_storage_key": it.photo_storage_key}
                for it in body.issues if it.description and it.description.strip()
            ]

    # Vehicle lookup + tenancy enforcement.
    veh = (
        await session.execute(select(Vehicle).where(Vehicle.id == body.vehicle_id))
    ).scalar_one_or_none()
    if veh is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")
    if current.role == UserRole.DSP_OWNER and veh.dsp_id != current.organization_id:
        # Same 404 (not 403) — don't leak the existence of other DSPs'
        # vehicles. Matches the pattern elsewhere in the codebase.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "vehicle not found")

    # picked_components_json carries BOTH the parts payload and the
    # repeating-issues list (one JSON blob keeps the schema simple
    # while Phase 2c+ irons out the data shapes; if either domain
    # grows it can move to its own table without a frontend change).
    blob: dict | None = None
    if picked_components_payload is not None or issues_payload:
        blob = {}
        if picked_components_payload is not None:
            blob["picked_components"] = picked_components_payload
        if issues_payload:
            blob["issues"] = issues_payload

    req = BodyRepairRequest(
        dsp_id=veh.dsp_id,
        vehicle_id=veh.id,
        submission_mode=body.mode,
        text_description=text_payload,
        target_grade=target_grade_payload,
        picked_components_json=blob,
        status=BodyRepairRequestStatus.PENDING_QUOTES,
        created_by_id=current.id,
    )
    session.add(req)
    await session.commit()
    await session.refresh(req)
    return await _build_response(session, req)


# ─────────────────────────────────────────────────────
# GET /body-repair/requests — role-scoped list
# ─────────────────────────────────────────────────────
@router.get(
    "/requests",
    response_model=BodyRepairRequestListResponse,
    summary="List body repair requests, scoped by caller's role",
)
async def list_requests(
    status_filter: BodyRepairRequestStatus | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BodyRepairRequestListResponse:
    """Role-scoped read of the body repair queue.

    Scoping rules:
      - dsp_owner             → WHERE dsp_id = current.org_id
      - body_repair_vendor_*  → WHERE assigned_vendor_id = current.org_id
                                OR status='pending_quotes' (open for bidding)
      - site_admin            → no filter
      - vendor (regular mech) → 403; body repair is its own surface
    """
    if current.role == UserRole.VENDOR_ADMIN or current.role == UserRole.SERVICE_WRITER:
        # Regular mech vendors don't see body repair work — different
        # org type entirely. The Body Repair Vendor tab is the entry
        # point for orgs with that capability.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "body repair is handled by body_repair_vendor orgs — not a mechanical vendor surface",
        )

    stmt = select(BodyRepairRequest).order_by(BodyRepairRequest.created_at.desc())

    if current.role == UserRole.DSP_OWNER:
        stmt = stmt.where(BodyRepairRequest.dsp_id == current.organization_id)
    elif current.role == UserRole.SITE_ADMIN:
        pass  # no extra filter
    else:
        # Body repair vendor — see their assigned work + the open queue.
        # Role check via the org_type rather than UserRole: a
        # body_repair_vendor's admin can be any role bound to that org.
        org = (
            await session.execute(
                select(Organization).where(Organization.id == current.organization_id)
            )
        ).scalar_one_or_none()
        if org is None or org.org_type != OrgType.BODY_REPAIR_VENDOR:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair vendor")
        stmt = stmt.where(
            (BodyRepairRequest.assigned_vendor_id == current.organization_id)
            | (BodyRepairRequest.status == BodyRepairRequestStatus.PENDING_QUOTES.value)
        )

    if status_filter is not None:
        stmt = stmt.where(BodyRepairRequest.status == status_filter.value)

    stmt = stmt.limit(limit)
    rows = list((await session.execute(stmt)).scalars().all())
    items = [await _build_response(session, r) for r in rows]
    return BodyRepairRequestListResponse(items=items, total=len(items))


# ─────────────────────────────────────────────────────
# GET /body-repair/requests/{id} — detail view
# ─────────────────────────────────────────────────────
@router.get(
    "/requests/{req_id}",
    response_model=BodyRepairRequestResponse,
)
async def get_request(
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BodyRepairRequestResponse:
    """Detail view. Same tenancy rules as the list endpoint —
    cross-tenant returns 404 silently."""

    # Accept either prefixed or bare int (Nova Fora convention).
    raw = str(req_id).strip()
    int_id: int | None = None
    if raw.upper().startswith("BRR-"):
        raw_num = raw[4:]
        if raw_num.isdigit():
            int_id = int(raw_num)
    elif raw.isdigit():
        int_id = int(raw)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    # Tenancy.
    if current.role == UserRole.DSP_OWNER and req.dsp_id != current.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    if current.role == UserRole.VENDOR_ADMIN or current.role == UserRole.SERVICE_WRITER:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair surface")
    # Body repair vendor — must be assigned OR request is still open.
    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        org = (
            await session.execute(
                select(Organization).where(Organization.id == current.organization_id)
            )
        ).scalar_one_or_none()
        if org is None or org.org_type != OrgType.BODY_REPAIR_VENDOR:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair vendor")
        if (
            req.assigned_vendor_id != current.organization_id
            and req.status != BodyRepairRequestStatus.PENDING_QUOTES
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    return await _build_response(session, req)


# ─────────────────────────────────────────────────────
# DELETE /body-repair/requests/{id} — rollback / abandon a draft
# ─────────────────────────────────────────────────────
@router.delete(
    "/requests/{req_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a draft body repair request (DSP owner only, pre-quotes)",
    responses={
        404: {"description": "Request not found or not yours."},
        409: {"description": "Request has progressed past the deletable state."},
    },
)
async def delete_request(
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Response:
    """Delete a body repair request that the customer wants to abandon.

    Allowed states: only `pending_quotes` — the request was just
    submitted and no vendor has bid yet. Once any quote arrives or
    the customer has selected one, the request leaves the deletable
    window (cancel-and-rebill semantics live in Phase 5).

    Auth:
      - DSP owner of the request's own DSP, OR
      - site_admin (operator cleanup)

    Used primarily by the frontend's "rollback PAVE failure" flow:
    when the customer attaches a PDF that fails to upload/parse, the
    create-modal calls this so an orphan request doesn't linger in
    their list.
    """
    raw = str(req_id).strip()
    int_id: int | None = None
    if raw.upper().startswith("BRR-"):
        raw_num = raw[4:]
        if raw_num.isdigit():
            int_id = int(raw_num)
    elif raw.isdigit():
        int_id = int(raw)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    # Tenancy:
    if current.role == UserRole.DSP_OWNER:
        if req.dsp_id != current.organization_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    elif current.role != UserRole.SITE_ADMIN:
        # Vendors / SW can't delete a request.
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not allowed")

    # State guard — only pre-quotes is rollback-safe. PAVE rows + quote
    # rows (if any) cascade via the FK ondelete='CASCADE' so a clean
    # delete here doesn't leave dangling children.
    if req.status != BodyRepairRequestStatus.PENDING_QUOTES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"request is in status '{req.status.value}'; only pending_quotes drafts can be deleted",
        )

    await session.delete(req)
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─────────────────────────────────────────────────────
# POST /body-repair/pave/parse-preview — PAVE-first flow (Phase 1c)
#
# Used BEFORE a request exists. The customer uploads a PAVE PDF via
# /uploads/presigned (kind='body_repair_pave_preview') and posts the
# storage_key here. We parse the PDF and return the structured summary
# without creating any DB row. The same storage_key gets attached to
# the real request when /requests/{id}/pave is called after submission.
#
# Why PAVE-first: the parsed VIN can validate the vehicle picker, the
# damage list can drive the parts picker, and the parse confirms BEFORE
# the customer fills out the rest of the form. Mirrors the demo's
# Step 1 (paste URL / upload) → Step 2 (scope & notes) flow.
# ─────────────────────────────────────────────────────
class ParsePavePreviewBody(BaseModel):
    storage_key: str = Field(..., min_length=1, max_length=500)

    model_config = ConfigDict(extra="forbid")


class ParsePavePreviewResponse(BaseModel):
    """The parsed PAVE summary — no DB row. Mirrors the rich summary
    the demo's PaveSummaryCard renders (NOVABODY/web BodyRepair.tsx
    line 1204).

    Beyond the basics (VIN / year / make / model), this carries the
    Fleet Condition grade + per-side damage counts + priority flags
    that give the customer a real read on the vehicle's state BEFORE
    they submit the request.

    `storage_key` is echoed back so the frontend can pass it to
    /requests/{id}/pave after the request is created — the same PDF
    in MinIO gets re-referenced, no re-upload.
    """

    storage_key: str
    parse_status: str  # 'ok' | 'failed'
    vin: str | None
    year: int | None
    make: str | None
    model: str | None
    inspection_date_utc: str | None

    # Grade & FCS (Fleet Condition Score)
    grade: int | None = None              # 0-5
    grade_label: str | None = None        # 'Great' | 'Good' | 'Fair' | 'Poor'
    grade_definition: str | None = None   # tooltip text
    current_fcs: int | None = None        # FCS sum across current damages
    current_grade: int | None = None      # FCS bracket (may differ from PAVE-reported grade)

    # Per-side breakdown (from PAVE's scores section)
    side_counts: dict | None = None       # {front, back, left, right}
    side_counts_total: int | None = None
    all_damages_count: int | None = None
    damage_count: int                     # backwards-compat with the simpler field
    total_score: int | None = None        # alias of grade for backwards-compat

    # Risk flags
    priority_detected: bool = False
    at_risk_of_grounding: bool = False

    # Damage detail — drives the priority table + parts picker
    components: list[dict] | None = None
    priority_components_top: list[dict] | None = None

    parse_warnings: list[str] | None = None

    model_config = ConfigDict(from_attributes=True)


def _current_damage_rows(parsed: dict) -> list[dict]:
    """Current per-side damages + new_damage rows not already covered.
    Mirrors the demo's _current_damage_rows. Repaired-damage rows are
    excluded — they're history, not actionable scope."""
    side_rows = parsed.get("damages") or []
    seen = {d.get("item_no") for d in side_rows if d.get("item_no") is not None}
    new_only = [
        d for d in (parsed.get("new_damage") or [])
        if d.get("item_no") is None or d.get("item_no") not in seen
    ]
    return side_rows + new_only


def _group_components(damages: list[dict]) -> list[dict]:
    """Group damage rows by component for the parts-picker UX.
    Verbatim port of the demo's _group_components."""
    by_component: dict[str, list[dict]] = {}
    for d in damages:
        by_component.setdefault(d.get("component") or "Other", []).append(d)
    groups = []
    for name, rows in by_component.items():
        scores = [r.get("fleet_score") for r in rows if r.get("fleet_score") is not None]
        groups.append({
            "name": name,
            "worst_score": min(scores) if scores else None,
            "priority": any(r.get("is_priority") for r in rows),
            "item_nos": [r.get("item_no") for r in rows if r.get("item_no") is not None],
            "damages": [
                {
                    "item_no": r.get("item_no"),
                    "damage_type": r.get("damage_type"),
                    "severity": r.get("severity"),
                    "repair_method": r.get("repair_method"),
                    "fleet_score": r.get("fleet_score"),
                    "raw_score": r.get("raw_score"),
                    "component_group": r.get("component_group"),
                    "size": r.get("size"),
                    "is_priority": bool(r.get("is_priority")),
                    "is_included": bool(r.get("is_included")),
                    "side": r.get("side"),
                    "photo_index": r.get("photo_index"),
                }
                for r in rows
            ],
        })
    # Priority components first; within each band, most-severe first
    # (score 4 is the worst on PAVE's part-damage scale), then by
    # damage count, then alphabetically.
    return sorted(groups, key=lambda c: (
        not c["priority"],
        -(c["worst_score"] or 0),
        -len(c["damages"]),
        c["name"] or "",
    ))


def _build_pave_summary(parsed: dict) -> dict:
    """Port of NOVABODY/web@mbk/body-repair-demo's _pave_summary
    (web/app/api/v2/endpoints/body_repair/endpoints.py line 216)."""
    from app.services.fca_scoring import (
        fcs_of,
        grade_definition,
        grade_for_fcs,
        grade_label,
    )

    scores = parsed.get("scores") or {}
    grade = scores.get("total")
    damages = _current_damage_rows(parsed)
    components = _group_components(damages)
    current_fcs = fcs_of(damages)
    # Mirror PAVE's auto-Poor rule: a priority defect caps the grade
    # at Poor (2) regardless of FCS.
    current_grade = grade_for_fcs(current_fcs)
    if current_grade > 2 and scores.get("priority_detected"):
        current_grade = 2

    # Display grade — PAVE-reported, capped at Poor on priority.
    display_grade = grade if isinstance(grade, int) else current_grade
    if isinstance(display_grade, int) and display_grade > 2 and scores.get("priority_detected"):
        display_grade = 2

    side_counts = {
        "front": scores.get("front_damage_count"),
        "back": scores.get("back_damage_count"),
        "left": scores.get("left_damage_count"),
        "right": scores.get("right_damage_count"),
    }
    side_total = sum(v for v in side_counts.values() if v is not None) or None

    # all_damages_count from PAVE; fall back to len(damages) for older
    # PAVE PDFs that don't print the change summary row.
    fallback_count = len(damages)
    all_count = scores.get("all_damages_count") or fallback_count

    # Top 5 priority components — for the "must repair to exit Poor"
    # table in the summary card.
    priority_components_top = [
        {
            "name": c["name"],
            "worst_score": c["worst_score"],
            "damage_count": len(c["damages"]),
            "item_nos": c["item_nos"],
            "damages": c["damages"],
        }
        for c in sorted(
            (g for g in components if g["priority"]),
            key=lambda g: (-(g["worst_score"] or 0), -len(g["damages"]), g["name"] or ""),
        )
    ][:5]

    return {
        "grade": display_grade if isinstance(display_grade, int) else None,
        "grade_label": (
            scores.get("total_label")
            or grade_label(display_grade)
        ),
        "grade_definition": grade_definition(display_grade) if isinstance(display_grade, int) else None,
        "current_fcs": current_fcs,
        "current_grade": current_grade,
        "priority_detected": bool(scores.get("priority_detected")),
        "at_risk_of_grounding": bool(scores.get("at_risk_of_grounding")),
        "side_counts": side_counts,
        "side_counts_total": side_total,
        "all_damages_count": all_count,
        "components": components,
        "priority_components_top": priority_components_top,
    }


@router.post(
    "/pave/parse-preview",
    response_model=ParsePavePreviewResponse,
    summary="Parse an already-uploaded PAVE PDF without creating a request",
    responses={
        403: {"description": "Only DSP owners and site_admins can preview."},
        409: {"description": "Could not download PDF from storage."},
    },
)
async def parse_pave_preview(
    body: ParsePavePreviewBody,
    current: User = Depends(get_current_user),
) -> ParsePavePreviewResponse:
    """Download + parse a PAVE PDF that was uploaded with
    kind='body_repair_pave_preview'. Returns the parsed summary
    without persisting anything."""
    import logging
    import os
    import tempfile

    log = logging.getLogger("nova.body_repair")

    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "only customers preview PAVE reports"
        )

    # Tenancy guard on the storage_key path: previews go under
    # "photos/body_repair_previews/" (the "photos/" root is added by
    # storage/s3.new_storage_key for ALL kinds — it's a misnomer at
    # this point, but every storage key has it). Refuse anything else
    # so a user can't parse a real request's PAVE this way (which
    # would 200 fine but is an info-leak vector if they guessed paths).
    if not body.storage_key.startswith("photos/body_repair_previews/"):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "storage_key must be a preview upload",
        )

    try:
        from app.services.pave_parser import parse_pave_report
        from app.settings import get_settings
        from app.storage.s3 import _public_client

        s = get_settings()
        cli = _public_client()
        try:
            obj = cli.get_object(Bucket=s.s3_bucket, Key=body.storage_key)
            pdf_bytes = obj["Body"].read()
        except Exception as e:  # noqa: BLE001
            log.warning(
                "parse_pave_preview: S3 fetch failed for key=%s: %s",
                body.storage_key, e,
            )
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"could not fetch PDF from storage: {type(e).__name__}: {e}",
            ) from e

        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        try:
            tmp.write(pdf_bytes)
            tmp.flush()
            tmp.close()
            parsed: dict = parse_pave_report(tmp.name)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

        summary = _build_pave_summary(parsed)
        warnings = parsed.get("parse_warnings") or None

        return ParsePavePreviewResponse(
            storage_key=body.storage_key,
            parse_status=parsed.get("parse_status", "failed"),
            vin=parsed.get("vin"),
            year=parsed.get("year"),
            make=parsed.get("make"),
            model=parsed.get("model"),
            inspection_date_utc=parsed.get("inspection_date_utc"),
            grade=summary["grade"],
            grade_label=summary["grade_label"],
            grade_definition=summary["grade_definition"],
            current_fcs=summary["current_fcs"],
            current_grade=summary["current_grade"],
            side_counts=summary["side_counts"],
            side_counts_total=summary["side_counts_total"],
            all_damages_count=summary["all_damages_count"],
            damage_count=summary["all_damages_count"] or 0,
            total_score=summary["grade"],
            priority_detected=summary["priority_detected"],
            at_risk_of_grounding=summary["at_risk_of_grounding"],
            components=summary["components"],
            priority_components_top=summary["priority_components_top"],
            parse_warnings=warnings,
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.exception("parse_pave_preview: unhandled exception")
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"parse_pave_preview failed: {type(e).__name__}: {e}",
        ) from e


# ─────────────────────────────────────────────────────
# POST /body-repair/requests/{id}/pave — Phase 1
#
# Attaches a parsed PAVE PDF to a request. The frontend uploads the PDF
# via the regular /uploads/presigned flow (kind='body_repair_pave'),
# then POSTs the resulting storage_key here. We download the PDF from
# MinIO into a temp file, run pave_parser, and store the structured
# data + metadata in body_repair_pave_reports.
# ─────────────────────────────────────────────────────
class AttachPaveBody(BaseModel):
    storage_key: str = Field(..., min_length=1, max_length=500)
    file_size_bytes: int | None = Field(default=None, ge=1)
    phase: PavePhase = Field(default=PavePhase.PRE)
    source: str | None = Field(default="upload", max_length=20)
    source_url: str | None = Field(default=None, max_length=1000)

    model_config = ConfigDict(extra="forbid")


class PaveReportResponse(BaseModel):
    id: str
    request_id: str
    phase: str
    storage_path: str
    file_size_bytes: int | None
    parse_status: str
    vin: str | None
    year: int | None
    make: str | None
    model: str | None
    inspection_date_utc: datetime | None
    total_score: int | None
    damage_count: int
    parsed_warnings: list[str] | None = None
    source: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


def _parse_req_id(raw: str) -> int | None:
    raw = str(raw).strip()
    if raw.upper().startswith("BRR-"):
        tail = raw[4:]
        return int(tail) if tail.isdigit() else None
    return int(raw) if raw.isdigit() else None


async def _require_request_scope(
    req: BodyRepairRequest, current: User, session: AsyncSession
) -> None:
    """Shared tenancy gate for PAVE endpoints. Same rules as
    get_request — cross-tenant returns 404 (no existence leak)."""
    if current.role == UserRole.DSP_OWNER and req.dsp_id != current.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    if current.role in (UserRole.VENDOR_ADMIN, UserRole.SERVICE_WRITER):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair surface")
    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        org = (
            await session.execute(
                select(Organization).where(Organization.id == current.organization_id)
            )
        ).scalar_one_or_none()
        if org is None or org.org_type != OrgType.BODY_REPAIR_VENDOR:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair vendor")
        if (
            req.assigned_vendor_id != current.organization_id
            and req.status != BodyRepairRequestStatus.PENDING_QUOTES
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")


def _pave_response(r: BodyRepairPaveReport, req: BodyRepairRequest) -> "PaveReportResponse":
    warnings = ((r.parsed_json or {}).get("parse_warnings") or None)
    return PaveReportResponse(
        id=r.id_str,
        request_id=req.id_str,
        phase=r.phase.value if hasattr(r.phase, "value") else r.phase,
        storage_path=r.storage_path,
        file_size_bytes=r.file_size_bytes,
        parse_status=r.parse_status.value if hasattr(r.parse_status, "value") else r.parse_status,
        vin=r.vin,
        year=r.year,
        make=r.make,
        model=r.model,
        inspection_date_utc=r.inspection_date_utc,
        total_score=r.total_score,
        damage_count=r.damage_count,
        parsed_warnings=warnings,
        source=r.source,
        created_at=r.created_at,
    )


@router.post(
    "/requests/{req_id}/pave",
    response_model=PaveReportResponse,
    summary="Attach + parse a PAVE PDF for a body repair request",
    responses={
        404: {"description": "Request not found, or cross-tenant."},
        409: {"description": "Could not download PDF from storage (bad storage_key)."},
    },
)
async def attach_pave(
    body: AttachPaveBody,
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PaveReportResponse:
    """Parse a PAVE PDF and link it to a body repair request.

    Flow:
      1. Resolve request + tenancy.
      2. Download PDF bytes from MinIO via the internal S3 client.
      3. Write to a temp file (`pave_parser` takes a path).
      4. Run `parse_pave_report` — returns dict, never raises. On
         failure parse_status='failed' and the row still lands so the
         SW can review manually.
      5. Insert body_repair_pave_reports row + return the shape.
    """
    import logging
    import os
    import tempfile
    import traceback

    log = logging.getLogger("nova.body_repair")

    try:
        int_id = _parse_req_id(req_id)
        if int_id is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
        req = (
            await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
        ).scalar_one_or_none()
        if req is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
        await _require_request_scope(req, current, session)

        # Lazy imports inside the function for two reasons:
        #  1. avoid pulling boto3 at module import time
        #  2. keep the parser import path next to the call site so any
        #     ImportError on poppler-utils / missing module is obvious
        from app.services.pave_parser import parse_pave_report
        from app.settings import get_settings
        from app.storage.s3 import _public_client

        # 2026-06-05 — use the PUBLIC S3 client, not the internal one.
        # On EasyPanel / Docker Swarm, the internal hostname is
        # `nova-fora_minio:9000` (stack_service convention) which has
        # an underscore — RFC 952 forbids underscores in hostnames
        # and boto3 rejects them with `ValueError: Invalid endpoint:`
        # BEFORE attempting the connection. The public endpoint
        # (settings.s3_public_endpoint) is the browser-facing URL
        # without an underscore and boto3 accepts it. A 2MB PDF
        # round-trips in ~50-200ms via the public path; acceptable
        # for an inline parse.
        s = get_settings()
        cli = _public_client()
        try:
            obj = cli.get_object(Bucket=s.s3_bucket, Key=body.storage_key)
            pdf_bytes = obj["Body"].read()
        except Exception as e:  # noqa: BLE001
            log.warning(
                "attach_pave: S3 fetch failed for key=%s: %s", body.storage_key, e
            )
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"could not fetch PDF from storage: {type(e).__name__}: {e}",
            ) from e

        tmp = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
        try:
            tmp.write(pdf_bytes)
            tmp.flush()
            tmp.close()
            parsed: dict = parse_pave_report(tmp.name)
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

        status_str = parsed.get("parse_status", "failed")
        inspection_date = parsed.get("inspection_date_utc")
        inspection_dt: datetime | None = None
        if inspection_date:
            try:
                inspection_dt = datetime.fromisoformat(str(inspection_date).replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                inspection_dt = None
        scores = parsed.get("scores", {}) or {}
        total_score = scores.get("total") or scores.get("overall")
        damages = parsed.get("damages") or []
        new_damages = parsed.get("new_damage") or []
        damage_count = len(damages) if damages else len(new_damages)

        row = BodyRepairPaveReport(
            request_id=req.id,
            phase=body.phase,
            storage_path=body.storage_key,
            file_size_bytes=body.file_size_bytes,
            parse_status=(
                PaveParseStatus.OK if status_str == "ok" else PaveParseStatus.FAILED
            ),
            vin=parsed.get("vin"),
            year=parsed.get("year"),
            make=parsed.get("make"),
            model=parsed.get("model"),
            inspection_date_utc=inspection_dt,
            total_score=int(total_score) if isinstance(total_score, (int, float)) else None,
            damage_count=damage_count,
            parsed_json=parsed,
            source=body.source,
            source_url=body.source_url,
            uploaded_by_id=current.id,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return _pave_response(row, req)
    except HTTPException:
        # Re-raise FastAPI's typed errors untouched.
        raise
    except Exception as e:  # noqa: BLE001
        # Last-resort safety net so the client gets a useful detail
        # instead of a bare "Internal Server Error". Logs the full
        # traceback to stdout for EasyPanel.
        log.exception("attach_pave: unhandled exception")
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            f"attach_pave failed: {type(e).__name__}: {e}",
        ) from e


@router.get(
    "/requests/{req_id}/pave",
    response_model=list[PaveReportResponse],
    summary="List PAVE reports attached to a body repair request",
)
async def list_pave(
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[PaveReportResponse]:
    int_id = _parse_req_id(req_id)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    await _require_request_scope(req, current, session)

    rows = list(
        (
            await session.execute(
                select(BodyRepairPaveReport)
                .where(BodyRepairPaveReport.request_id == req.id)
                .order_by(BodyRepairPaveReport.created_at.asc())
            )
        ).scalars().all()
    )
    return [_pave_response(r, req) for r in rows]


# ═════════════════════════════════════════════════════
# PHASE 2 — Quote endpoints (port of NOVABODY/web@mbk/body-repair-demo
#   app/api/v2/endpoints/body_repair/quotes.py)
# ═════════════════════════════════════════════════════
# Mirrors the demo's 5 core flows:
#   GET    /requests/{id}/quotes           — list with per-role projection
#   POST   /requests/{id}/quotes           — vendor submits a quote
#   POST   /requests/{id}/select-quote     — customer picks one
#   POST   /requests/{id}/decline-quotes   — customer rejects all active
#   POST   /requests/{id}/renew-quote      — vendor extends validity
#
# Revisions (Phase 4) deferred — schema is in place from migration
# 20260604_0000 but the endpoints land with the rest of the in-repair
# lifecycle.
# ─────────────────────────────────────────────────────

# Pricing constants — defaults match the demo. Env overrides exist as
# Settings will land later; for now constants live here so the math is
# in one place.
TIER_1_DISCOUNT_PCT = 20.0           # currently unused (tiers = list)
TIER_2_DISCOUNT_PCT = 10.0
CONTRACT_COMMISSION_PCT = 8.5        # contract DSPs pay less
NON_CONTRACT_COMMISSION_PCT = 20.0
QUOTE_VALIDITY_DAYS = 7

# Statuses where a request is open for new quotes (or first submission).
_OPEN_FOR_QUOTES: frozenset = frozenset((
    BodyRepairRequestStatus.PENDING_QUOTES,
    BodyRepairRequestStatus.QUOTED,
))


def markup_quote(vendor_raw_cents: int, commission_pct: float | Decimal) -> dict:
    """Vendor cost → list price. Verbatim port of the demo's
    markup_quote(). Tier columns = list until a future tier ladder
    reactivates."""
    pct = float(commission_pct) if commission_pct is not None else 0.0
    base = round(vendor_raw_cents * (1 + pct / 100.0))
    return {
        "base_cents": base,
        "list_cents": base,
        "tier_1_cents": base,
        "tier_2_cents": base,
    }


def _commission_for_org(customer_org: Organization | None) -> float:
    """Contract DSPs pay the lower commission. For now everyone is
    non-contract since `body_repair_contract` isn't on the Organization
    model yet — that flag will land with Phase 5 (contract onboarding).
    Keeping the helper here so the rest of the code can call it
    unchanged when the flag arrives."""
    return NON_CONTRACT_COMMISSION_PCT


def _clean_line_items(raw_items: list[dict] | None) -> tuple[list[dict], int]:
    """Drop empty rows; sum vendor_raw_cents. Mirrors the demo's
    _clean_line_items / _parse_line_items."""
    items: list[dict] = []
    for li in (raw_items or []):
        parts = li.get("parts_cents") or 0
        labor = li.get("labor_cents") or 0
        if parts + labor <= 0:
            continue
        items.append({
            "description": (li.get("description") or "").strip() or None,
            "parts_cents": parts,
            "labor_cents": labor,
        })
    vendor_raw = sum(it["parts_cents"] + it["labor_cents"] for it in items)
    return items, vendor_raw


async def _require_body_repair_vendor(
    current: User, session: AsyncSession
) -> Organization:
    """Auth + role helper for vendor-side endpoints. Mirrors the demo's
    `_require_vendor()` — must be a member of an org whose org_type is
    BODY_REPAIR_VENDOR. Returns the org for downstream FK use.

    site_admin is permitted (operator may submit a quote on behalf of a
    vendor during onboarding); they pass an explicit vendor_org_id in
    the body in that case (Phase 5 surface, not needed yet)."""
    if current.role == UserRole.SITE_ADMIN:
        # Site admin is permitted but needs a vendor org id; defer to
        # the route to read it from the body.
        return None  # type: ignore[return-value]
    org = (
        await session.execute(
            select(Organization).where(Organization.id == current.organization_id)
        )
    ).scalar_one_or_none()
    if org is None or org.org_type != OrgType.BODY_REPAIR_VENDOR:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair vendor")
    return org


def _quote_response(
    q: BodyRepairQuote,
    line_items: list[BodyRepairQuoteLineItem],
    vendor_name: str | None,
    view: str = "customer",
) -> dict:
    """Project a quote row to the response shape, applying the
    disclosure rules per role.

    view='customer' → list/platform_fee/tier_*; line items WITHOUT
                       per-line cents (the customer sees the headline only)
    view='vendor'   → vendor_raw + line items at raw cost
    view='admin'    → all fields (customer + vendor + commission)
    """
    is_expired = bool(q.valid_until and q.valid_until < utc_now())
    expires_in: str | None = None
    if q.valid_until:
        now = utc_now()
        delta = (now - q.valid_until) if is_expired else (q.valid_until - now)
        days = delta.days
        if days >= 1:
            expires_in = f"expired {days}d ago" if is_expired else f"in {days}d"
        else:
            hours = max(int(delta.total_seconds() // 3600), 1)
            expires_in = f"expired {hours}h ago" if is_expired else f"in {hours}h"

    base: dict = {
        "id": q.id_str,
        "request_id": f"BRR-{q.body_repair_request_id:05d}",
        "vendor_org_id": q.vendor_org_id,
        "vendor_org_name": vendor_name,
        "status": q.status.value if hasattr(q.status, "value") else q.status,
        "duration_days": q.duration_days,
        "notes": q.notes,
        "valid_until": q.valid_until.isoformat() if q.valid_until else None,
        "is_expired": is_expired,
        "expires_in": expires_in,
        "renewed_count": q.renewed_count,
        "created_at": q.created_at.isoformat() if q.created_at else None,
    }
    if view in ("customer", "admin"):
        base["list_cents"] = q.list_cents
        base["tier_1_cents"] = q.tier_1_cents
        base["tier_2_cents"] = q.tier_2_cents
        base["tier_1_savings_cents"] = max(0, (q.list_cents or 0) - (q.tier_1_cents or 0))
        base["tier_2_savings_cents"] = max(0, (q.list_cents or 0) - (q.tier_2_cents or 0))
        base["platform_fee_cents"] = q.platform_fee_cents
    if view in ("vendor", "admin"):
        base["vendor_raw_cents"] = q.vendor_raw_cents
    if view == "admin":
        base["base_cents"] = q.base_cents
        base["commission_pct"] = float(q.commission_pct) if q.commission_pct is not None else None

    if view == "vendor":
        # Vendor sees their raw line items.
        base["line_items"] = [
            {
                "id": li.id_str if hasattr(li, "id_str") else str(li.id),
                "position": li.position,
                "description": li.description,
                "parts_cents": li.parts_cents,
                "labor_cents": li.labor_cents,
                "total_cents": (li.parts_cents or 0) + (li.labor_cents or 0),
            }
            for li in line_items
        ]
    elif view == "customer":
        # Customer sees the vendor's line items at COST (no per-item
        # markup), plus the single platform fee line above. Mirrors the
        # demo's serialize(customer_view=True) which calls
        # li.serialize(customer_view=False) — yes, that's intentional:
        # the customer sees vendor cost per line, then ONE platform fee
        # added at the end.
        base["line_items"] = [
            {
                "id": li.id_str if hasattr(li, "id_str") else str(li.id),
                "position": li.position,
                "description": li.description,
                "parts_cents": li.parts_cents,
                "labor_cents": li.labor_cents,
                "total_cents": (li.parts_cents or 0) + (li.labor_cents or 0),
            }
            for li in line_items
        ]
    else:  # admin
        base["line_items"] = [
            {
                "id": li.id_str if hasattr(li, "id_str") else str(li.id),
                "position": li.position,
                "description": li.description,
                "parts_cents": li.parts_cents,
                "labor_cents": li.labor_cents,
                "total_cents": (li.parts_cents or 0) + (li.labor_cents or 0),
            }
            for li in line_items
        ]

    # Revisions list deferred — Phase 4 adds the read.
    base["revisions"] = []
    return base


async def _quotes_with_items(
    session: AsyncSession, request_id: int
) -> list[tuple[BodyRepairQuote, list[BodyRepairQuoteLineItem]]]:
    """Load all quotes on a request + their line items. Two queries
    (request → quotes, then one batch fetch for line items keyed by
    quote_id) instead of N+1."""
    quotes = list(
        (
            await session.execute(
                select(BodyRepairQuote)
                .where(BodyRepairQuote.body_repair_request_id == request_id)
                .order_by(BodyRepairQuote.created_at.asc())
            )
        ).scalars().all()
    )
    if not quotes:
        return []
    quote_ids = [q.id for q in quotes]
    items_rows = list(
        (
            await session.execute(
                select(BodyRepairQuoteLineItem)
                .where(BodyRepairQuoteLineItem.quote_id.in_(quote_ids))
                .order_by(BodyRepairQuoteLineItem.position.asc())
            )
        ).scalars().all()
    )
    by_quote: dict[int, list[BodyRepairQuoteLineItem]] = {}
    for li in items_rows:
        by_quote.setdefault(li.quote_id, []).append(li)
    return [(q, by_quote.get(q.id, [])) for q in quotes]


# ─────────────────────────────────────────────────────
# GET /body-repair/requests/{id}/quotes
# ─────────────────────────────────────────────────────
@router.get(
    "/requests/{req_id}/quotes",
    summary="List quotes on a request, per-role projection",
)
async def list_quotes(
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    int_id = _parse_req_id(req_id)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    # Determine view.
    is_admin = current.role == UserRole.SITE_ADMIN
    is_customer = (
        current.role == UserRole.DSP_OWNER
        and req.dsp_id == current.organization_id
    )
    is_vendor = False
    vendor_org_id_to_filter: int | None = None
    if not is_admin and not is_customer:
        org = (
            await session.execute(
                select(Organization).where(Organization.id == current.organization_id)
            )
        ).scalar_one_or_none()
        if org is not None and org.org_type == OrgType.BODY_REPAIR_VENDOR:
            is_vendor = True
            vendor_org_id_to_filter = org.id

    if not (is_admin or is_customer or is_vendor):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    all_pairs = await _quotes_with_items(session, req.id)
    # Customer sees only active + selected. Vendor sees only their own.
    if is_admin:
        pairs = all_pairs
        view = "admin"
    elif is_customer:
        pairs = [(q, lis) for (q, lis) in all_pairs
                 if q.status in (BodyRepairQuoteStatus.ACTIVE, BodyRepairQuoteStatus.SELECTED)]
        view = "customer"
    else:  # vendor
        pairs = [(q, lis) for (q, lis) in all_pairs if q.vendor_org_id == vendor_org_id_to_filter]
        view = "vendor"

    # Resolve vendor names in one query.
    vendor_ids = list({q.vendor_org_id for (q, _) in pairs})
    name_by_id: dict[int, str] = {}
    if vendor_ids:
        rows = (
            await session.execute(
                select(Organization).where(Organization.id.in_(vendor_ids))
            )
        ).scalars().all()
        name_by_id = {o.id: o.name for o in rows}

    quotes_out = [
        _quote_response(q, lis, name_by_id.get(q.vendor_org_id), view=view)
        for (q, lis) in pairs
    ]
    return {
        "is_vendor": is_vendor,
        "is_admin": is_admin,
        "is_customer": is_customer,
        "quotes": quotes_out,
    }


# ─────────────────────────────────────────────────────
# POST /body-repair/requests/{id}/quotes — vendor submits a quote
# ─────────────────────────────────────────────────────
class _QuoteLineItemBody(BaseModel):
    description: str | None = Field(default=None, max_length=300)
    parts_cents: int = Field(default=0, ge=0)
    labor_cents: int = Field(default=0, ge=0)


class SubmitQuoteBody(BaseModel):
    line_items: list[_QuoteLineItemBody] = Field(default_factory=list)
    duration_days: int | None = Field(default=None, ge=0, le=365)
    notes: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid")


@router.post(
    "/requests/{req_id}/quotes",
    summary="Body repair vendor submits a quote on an open request",
    status_code=status.HTTP_201_CREATED,
    responses={
        403: {"description": "Not a body-repair vendor."},
        404: {"description": "Request not found."},
        409: {"description": "Request not open for quotes, or vendor already has an active quote."},
    },
)
async def submit_quote(
    body: SubmitQuoteBody,
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    int_id = _parse_req_id(req_id)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    vendor_org = await _require_body_repair_vendor(current, session)
    if vendor_org is None:
        # site_admin path — not supported in Phase 2; needs the body to
        # carry a vendor_org_id (Phase 5 onboarding).
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "site_admin quote-on-behalf-of-vendor not implemented yet",
        )

    if req.status not in _OPEN_FOR_QUOTES:
        raise HTTPException(status.HTTP_409_CONFLICT, "request is no longer open for quotes")

    # Already an active quote from this vendor?
    existing = (
        await session.execute(
            select(BodyRepairQuote)
            .where(BodyRepairQuote.body_repair_request_id == req.id)
            .where(BodyRepairQuote.vendor_org_id == vendor_org.id)
            .where(BodyRepairQuote.status == BodyRepairQuoteStatus.ACTIVE.value)
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "you already have an active quote on this request",
        )

    items, vendor_raw = _clean_line_items([li.model_dump() for li in body.line_items])
    if vendor_raw <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "add at least one priced line item")

    customer_org = (
        await session.execute(
            select(Organization).where(Organization.id == req.dsp_id)
        )
    ).scalar_one_or_none()
    commission = _commission_for_org(customer_org)
    priced = markup_quote(vendor_raw, commission)

    from datetime import timedelta
    quote = BodyRepairQuote(
        body_repair_request_id=req.id,
        vendor_org_id=vendor_org.id,
        status=BodyRepairQuoteStatus.ACTIVE,
        vendor_raw_cents=vendor_raw,
        base_cents=priced["base_cents"],
        list_cents=priced["list_cents"],
        tier_1_cents=priced["tier_1_cents"],
        tier_2_cents=priced["tier_2_cents"],
        commission_pct=Decimal(str(commission)),
        duration_days=body.duration_days,
        notes=(body.notes or "").strip() or None,
        valid_until=utc_now() + timedelta(days=QUOTE_VALIDITY_DAYS),
    )
    session.add(quote)
    await session.flush()

    for pos, li in enumerate(items):
        session.add(BodyRepairQuoteLineItem(
            quote_id=quote.id,
            position=pos,
            description=li["description"],
            parts_cents=li["parts_cents"],
            labor_cents=li["labor_cents"],
        ))

    if req.status == BodyRepairRequestStatus.PENDING_QUOTES:
        req.status = BodyRepairRequestStatus.QUOTED
        session.add(req)

    await session.commit()
    await session.refresh(quote)

    # Re-fetch line items for the response.
    refreshed_items = list(
        (
            await session.execute(
                select(BodyRepairQuoteLineItem)
                .where(BodyRepairQuoteLineItem.quote_id == quote.id)
                .order_by(BodyRepairQuoteLineItem.position.asc())
            )
        ).scalars().all()
    )
    return {
        "quote": _quote_response(quote, refreshed_items, vendor_org.name, view="vendor"),
    }


# ─────────────────────────────────────────────────────
# POST /body-repair/requests/{id}/select-quote
# ─────────────────────────────────────────────────────
class SelectQuoteBody(BaseModel):
    quote_id: str | int = Field(...)

    model_config = ConfigDict(extra="forbid")


def _parse_quote_id(raw: str | int) -> int | None:
    if isinstance(raw, int):
        return raw
    s = str(raw).strip()
    if s.upper().startswith("BRQ-"):
        tail = s[4:]
        return int(tail) if tail.isdigit() else None
    return int(s) if s.isdigit() else None


@router.post(
    "/requests/{req_id}/select-quote",
    summary="Customer selects a quote — locks vendor + freezes baseline",
)
async def select_quote(
    body: SelectQuoteBody,
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "customer-only action")
    int_id = _parse_req_id(req_id)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None or (
        current.role == UserRole.DSP_OWNER and req.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    if req.status not in _OPEN_FOR_QUOTES:
        raise HTTPException(status.HTTP_409_CONFLICT, "a quote has already been selected")

    quote_int_id = _parse_quote_id(body.quote_id)
    if quote_int_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid quote_id")
    quote = (
        await session.execute(
            select(BodyRepairQuote).where(BodyRepairQuote.id == quote_int_id)
        )
    ).scalar_one_or_none()
    if (
        quote is None
        or quote.body_repair_request_id != req.id
        or quote.status != BodyRepairQuoteStatus.ACTIVE
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "quote not found")
    if quote.valid_until and quote.valid_until < utc_now():
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "that quote has expired; ask the vendor to renew it before accepting",
        )

    # Promote the chosen quote; mark the others declined.
    quote.status = BodyRepairQuoteStatus.SELECTED
    session.add(quote)
    siblings = list(
        (
            await session.execute(
                select(BodyRepairQuote)
                .where(BodyRepairQuote.body_repair_request_id == req.id)
                .where(BodyRepairQuote.id != quote.id)
                .where(BodyRepairQuote.status == BodyRepairQuoteStatus.ACTIVE.value)
            )
        ).scalars().all()
    )
    for sib in siblings:
        sib.status = BodyRepairQuoteStatus.DECLINED
        session.add(sib)

    req.assigned_vendor_id = quote.vendor_org_id
    req.selected_quote_id = quote.id
    req.quote_selected_at = utc_now()
    req.approved_list_cents = quote.list_cents
    req.status = BodyRepairRequestStatus.QUOTE_SELECTED
    session.add(req)
    await session.commit()
    await session.refresh(req)

    return await _build_response(session, req)


# ─────────────────────────────────────────────────────
# POST /body-repair/requests/{id}/decline-quotes — customer rejects all
# ─────────────────────────────────────────────────────
@router.post(
    "/requests/{req_id}/decline-quotes",
    summary="Customer declines all active quotes — request stays open for new ones",
)
async def decline_quotes(
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    if current.role not in (UserRole.DSP_OWNER, UserRole.SITE_ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "customer-only action")
    int_id = _parse_req_id(req_id)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None or (
        current.role == UserRole.DSP_OWNER and req.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")

    actives = list(
        (
            await session.execute(
                select(BodyRepairQuote)
                .where(BodyRepairQuote.body_repair_request_id == req.id)
                .where(BodyRepairQuote.status == BodyRepairQuoteStatus.ACTIVE.value)
            )
        ).scalars().all()
    )
    for q in actives:
        q.status = BodyRepairQuoteStatus.DECLINED
        session.add(q)
    # Request reverts to pending_quotes so new bids can come in.
    req.status = BodyRepairRequestStatus.PENDING_QUOTES
    session.add(req)
    await session.commit()
    await session.refresh(req)
    return await _build_response(session, req)


# ─────────────────────────────────────────────────────
# POST /body-repair/requests/{id}/renew-quote — vendor extends validity
# ─────────────────────────────────────────────────────
@router.post(
    "/requests/{req_id}/renew-quote",
    summary="Vendor extends their active quote's validity window",
)
async def renew_quote(
    req_id: str = Path(..., examples=["BRR-00001"]),
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    vendor_org = await _require_body_repair_vendor(current, session)
    if vendor_org is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not a body repair vendor")
    int_id = _parse_req_id(req_id)
    if int_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    req = (
        await session.execute(select(BodyRepairRequest).where(BodyRepairRequest.id == int_id))
    ).scalar_one_or_none()
    if req is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "body repair request not found")
    if req.status not in _OPEN_FOR_QUOTES:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "renewal is only available while waiting on the customer",
        )

    quote = (
        await session.execute(
            select(BodyRepairQuote)
            .where(BodyRepairQuote.body_repair_request_id == req.id)
            .where(BodyRepairQuote.vendor_org_id == vendor_org.id)
            .where(BodyRepairQuote.status == BodyRepairQuoteStatus.ACTIVE.value)
        )
    ).scalar_one_or_none()
    if quote is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no active quote of yours to renew")

    from datetime import timedelta
    quote.valid_until = utc_now() + timedelta(days=QUOTE_VALIDITY_DAYS)
    quote.renewed_count = (quote.renewed_count or 0) + 1
    session.add(quote)
    await session.commit()
    await session.refresh(quote)

    items = list(
        (
            await session.execute(
                select(BodyRepairQuoteLineItem)
                .where(BodyRepairQuoteLineItem.quote_id == quote.id)
                .order_by(BodyRepairQuoteLineItem.position.asc())
            )
        ).scalars().all()
    )
    return {"quote": _quote_response(quote, items, vendor_org.name, view="vendor")}
