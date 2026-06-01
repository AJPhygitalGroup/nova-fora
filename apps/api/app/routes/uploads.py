"""Upload endpoints — generic presigned URL minting for any photo parent.

Flow:
    Client                      API                     MinIO
      │                          │                        │
      │─── POST /uploads/         │                        │
      │    presigned ───────────►│                        │
      │                          │ validate scope         │
      │                          │ generate key + URL     │
      │◄───{upload_url, key}─────│                        │
      │                                                   │
      │─── PUT upload_url {file} ────────────────────────►│
      │◄───────────────── 200 OK ─────────────────────────│
      │                          │                        │
      │─── POST /defects/{id}/    │                       │
      │    photos {key, ...}──► (commit route, different) │
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.db import get_session
from app.models.defect import Defect
from app.models.inspection import Inspection
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.work_orders import VendorWorkshop, WorkOrder
from app.routes.inspections import _parse_inspection_id
from app.routes.vehicles import _parse_vehicle_id  # shared helper
from app.schemas.photo import (
    PresignedUploadRequest,
    PresignedUploadResponse,
    UploadKind,
)
from app.storage.s3 import generate_upload_url, new_storage_key

router = APIRouter(prefix="/uploads", tags=["uploads"])


def _parse_defect_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("FD-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid defect id: {raw!r}. Use int or 'FD-XXX'.",
        ) from None


def _parse_wo_id(raw: str) -> int:
    s = raw.strip().upper()
    if s.startswith("WO-"):
        s = s[3:]
    try:
        return int(s)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"invalid work-order id: {raw!r}. Use int or 'WO-XXXXX'.",
        ) from None


async def _check_parent_access(
    kind: UploadKind,
    parent_id: str,
    current: User,
    session: AsyncSession,
) -> tuple[str, int]:
    """Verify the user can attach photos to this parent. Returns (kind_str, int_id).

    Photo upload rules:
      - Inspection photos: inspector (technician / vendor_admin) OR dsp_owner
        of the parent DSP OR site_admin.
      - Defect photos: same (the tech who reported it, plus reviewers).
      - WO photos: TBD in Semana 4.
    """
    if kind == UploadKind.DEFECT:
        did = _parse_defect_id(parent_id)
        defect = (
            await session.execute(select(Defect).where(Defect.id == did))
        ).scalar_one_or_none()
        if defect is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "defect not found")
        # V2.2: defects can be off-inspection (inspection_id NULL). For
        # those, scope by the parent vehicle's DSP rather than an inspection.
        if defect.inspection_id is not None:
            insp = (
                await session.execute(
                    select(Inspection).where(Inspection.id == defect.inspection_id)
                )
            ).scalar_one_or_none()
            _require_inspection_scope(insp, current)
        else:
            vehicle = (
                await session.execute(
                    select(Vehicle).where(Vehicle.id == defect.vehicle_id)
                )
            ).scalar_one_or_none()
            if vehicle is None:
                raise HTTPException(
                    status.HTTP_500_INTERNAL_SERVER_ERROR, "dangling vehicle"
                )
            if (
                current.role == UserRole.DSP_OWNER
                and vehicle.dsp_id != current.organization_id
            ):
                raise HTTPException(status.HTTP_403_FORBIDDEN, "not your defect")
        return ("defects", defect.id)

    if kind == UploadKind.INSPECTION:
        iid = _parse_inspection_id(parent_id)
        insp = (
            await session.execute(select(Inspection).where(Inspection.id == iid))
        ).scalar_one_or_none()
        if insp is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "inspection not found")
        _require_inspection_scope(insp, current)
        return ("inspections", insp.id)

    if kind == UploadKind.WORK_ORDER:
        wid = _parse_wo_id(parent_id)
        wo = (
            await session.execute(select(WorkOrder).where(WorkOrder.id == wid))
        ).scalar_one_or_none()
        if wo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "work order not found")
        await _require_wo_scope(wo, current, session)
        return ("work_orders", wo.id)

    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"unknown kind: {kind}")


def _require_inspection_scope(insp: Inspection | None, current: User) -> None:
    if insp is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "parent inspection not found")
    # DSP owners scoped to own org; others (technician, vendor_admin, site_admin) allowed.
    if (
        current.role == UserRole.DSP_OWNER
        and insp.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your inspection")


async def _require_wo_scope(wo: WorkOrder, current: User, session: AsyncSession) -> None:
    """WO photos: visible parties (DSP, vendor workshop's org, assigned tech) + site_admin.

    V2.0 note: the vendor relationship is now indirect — `wo.vendor_workshop_id`
    points to a `VendorWorkshop`, which optionally has `organization_id` set to
    the Nova Fora vendor org. We resolve it lazily here.
    """
    if current.role == UserRole.SITE_ADMIN:
        return
    if (
        current.role == UserRole.DSP_OWNER
        and wo.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your work order")
    if current.role in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN):
        # Resolve the workshop's owning org. Vendor scope = workshop org matches.
        # Tech scope = either workshop org matches OR they're assigned to the WO.
        workshop = (
            await session.execute(
                select(VendorWorkshop).where(VendorWorkshop.id == wo.vendor_workshop_id)
            )
        ).scalar_one_or_none()
        workshop_org_id = workshop.organization_id if workshop else None
        is_their_workshop = (
            workshop_org_id is not None
            and workshop_org_id == current.organization_id
        )
        is_their_assignment = (
            current.role == UserRole.TECHNICIAN
            and wo.assigned_technician_id == current.id
        )
        if not (is_their_workshop or is_their_assignment):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not your work order")


@router.post("/presigned", response_model=PresignedUploadResponse)
async def create_presigned_upload(
    body: PresignedUploadRequest,
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PresignedUploadResponse:
    """Mint a presigned PUT URL for a new photo.

    The client uses the returned URL to PUT the bytes directly to MinIO.
    After the upload succeeds, the client calls the parent-specific commit
    endpoint (e.g. POST /defects/{id}/photos) with the storage_key.
    """
    kind_str, parent_int_id = await _check_parent_access(
        body.kind, body.parent_id, current, session
    )
    storage_key = new_storage_key(kind_str, parent_int_id, body.filename)
    url, ttl = generate_upload_url(
        storage_key, body.content_type, size_bytes=body.size_bytes,
    )
    return PresignedUploadResponse(
        upload_url=url, storage_key=storage_key, expires_in=ttl
    )
