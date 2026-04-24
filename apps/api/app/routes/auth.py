"""Authentication endpoints.

  POST /auth/login     email+password → {access, refresh}
  POST /auth/refresh   refresh token → new access (+ rotated refresh)
  POST /auth/logout    stateless JWT — server-side is a no-op, frontend clears storage
  GET  /auth/me        returns the current user (full UserResponse shape)
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.dependencies import get_current_user
from app.auth.hashing import verify_password
from app.auth.jwt import (
    TokenError,
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.db import get_session
from app.models.organization import Organization
from app.models.user import User, UserStatus
from app.schemas.auth import LoginRequest, RefreshRequest, TokenPair
from app.schemas.user import UserResponse
from app.settings import get_settings
from app.models.base import utc_now

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


async def _build_user_response(user: User, session: AsyncSession) -> UserResponse:
    """Fetch the user's org so the response includes org name + prefixed id."""
    org = (
        await session.execute(
            select(Organization).where(Organization.id == user.organization_id)
        )
    ).scalar_one_or_none()
    if org is None:
        # Shouldn't happen due to FK, but defensive.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="user has dangling organization_id",
        )
    return UserResponse.from_user_and_org(
        user=user,
        org_name=org.name,
        org_id_str=org.id_str,
        org_type=org.org_type.value,
    )


@router.post(
    "/login",
    response_model=TokenPair,
    summary="Login with email + password",
    responses={
        401: {"description": "Invalid credentials"},
        403: {"description": "User disabled or pending"},
    },
)
async def login(
    body: LoginRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenPair:
    user = (
        await session.execute(select(User).where(User.email == body.email.lower()))
    ).scalar_one_or_none()

    # Same 401 for both "no user" and "wrong password" → prevents user enumeration.
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid credentials",
        )

    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"user status is {user.status.value}",
        )

    # Update last_login_at (best effort — don't fail login if this fails)
    user.last_login_at = utc_now()
    session.add(user)
    await session.commit()

    return TokenPair(
        access_token=create_access_token(user_id=user.id),
        refresh_token=create_refresh_token(user_id=user.id),
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Exchange a refresh token for a new access + refresh pair",
    responses={401: {"description": "Invalid or expired refresh token"}},
)
async def refresh(
    body: RefreshRequest,
    session: AsyncSession = Depends(get_session),
) -> TokenPair:
    try:
        payload = decode_token(body.refresh_token, expected_type=TokenType.REFRESH)
    except TokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)
        ) from e

    try:
        user_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token subject",
        ) from None

    user = (
        await session.execute(select(User).where(User.id == user_id))
    ).scalar_one_or_none()
    if user is None or user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user no longer active"
        )

    return TokenPair(
        access_token=create_access_token(user_id=user.id),
        refresh_token=create_refresh_token(user_id=user.id),
        expires_in=settings.jwt_access_token_expire_minutes * 60,
    )


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Logout (stateless — clears client-side state only)",
)
async def logout(current: User = Depends(get_current_user)) -> None:
    """With stateless JWT, logout is client-side. This endpoint exists as a
    hook for future features (token revocation list, audit log, etc.).

    Returns 204. Requires a valid access token so only authenticated users
    can hit it (for audit logging later).
    """
    # TODO(Semana 7 — Hardening): insert token jti into Redis denylist.
    _ = current  # silence unused — present for future use
    return None


@router.get(
    "/me",
    response_model=UserResponse,
    summary="Return the currently authenticated user",
)
async def me(
    current: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
    return await _build_user_response(current, session)
