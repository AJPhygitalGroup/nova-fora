"""Auth request/response schemas (Pydantic)."""
from pydantic import BaseModel, ConfigDict, EmailStr


class LoginRequest(BaseModel):
    """POST /auth/login payload — matches frontend Login.jsx submit shape."""

    email: EmailStr
    password: str

    model_config = ConfigDict(extra="forbid")


class RefreshRequest(BaseModel):
    """POST /auth/refresh payload."""

    refresh_token: str

    model_config = ConfigDict(extra="forbid")


class TokenPair(BaseModel):
    """Response body for /auth/login and /auth/refresh."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds until access_token expires
