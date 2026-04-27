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
from app.models.inspection import Inspection, ReportedDefect
from app.models.user import User, UserRole
from app.models.vehicle import Vehicle
from app.models.work_order import WorkOrder
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
            await session.execute(select(ReportedDefect).where(ReportedDefect.id == did))
        ).scalar_one_or_none()
        if defect is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "defect not found")
        insp = (
            await session.execute(
                select(Inspection).where(Inspection.id == defect.inspection_id)
            )
        ).scalar_one_or_none()
        _require_inspection_scope(insp, current)
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
        _require_wo_scope(wo, current)
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


def _require_wo_scope(wo: WorkOrder, current: User) -> None:
    """WO photos: visible parties (DSP, vendor, assigned tech) + site_admin."""
    if current.role == UserRole.SITE_ADMIN:
        return
    if (
        current.role == UserRole.DSP_OWNER
        and wo.dsp_id != current.organization_id
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not your work order")
    if (
        current.role in (UserRole.VENDOR_ADMIN, UserRole.TECHNICIAN)
        and wo.vendor_id != current.organization_id
    ):
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
    url, ttl = generate_upload_url(storage_key, body.content_type)
    return PresignedUploadResponse(
        upload_url=url, storage_key=storage_key, expires_in=ttl
    )
