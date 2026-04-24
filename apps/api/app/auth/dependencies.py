"""FastAPI dependencies for auth — `get_current_user`, role guards."""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.auth.jwt import TokenError, TokenType, decode_token
from app.db import get_session
from app.models.user import User, UserRole, UserStatus

# HTTPBearer extracts the `Authorization: Bearer <token>` header.
# auto_error=False → we emit our own 401 with a useful message.
_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> User:
    """Validates the Bearer access token and returns the User row.

    401 if: header missing, token invalid/expired, wrong type, user not found,
    or user status is not ACTIVE.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_token(credentials.credentials, expected_type=TokenType.ACCESS)
    except TokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        ) from e

    try:
        user_id = int(payload["sub"])
    except (ValueError, KeyError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid token subject",
        ) from None

    user = (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found"
        )
    if user.status != UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"user status is {user.status.value}",
        )
    return user


def require_role(*allowed: UserRole):
    """Dependency factory — restrict an endpoint to specific roles.

    Usage:
        @router.get("/admin/users", dependencies=[Depends(require_role(UserRole.SITE_ADMIN))])
    """

    async def _check(current: User = Depends(get_current_user)) -> User:
        if current.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"requires role in {[r.value for r in allowed]}",
            )
        return current

    return _check
