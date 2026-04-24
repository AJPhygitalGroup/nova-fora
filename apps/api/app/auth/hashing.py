"""Password hashing with bcrypt.

passlib wraps bcrypt with proper salting + cost tuning. Never store plaintext.
"""
from passlib.context import CryptContext

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plaintext: str) -> str:
    """Return a bcrypt hash. ~250ms cost at default rounds (12) on typical VPS."""
    return _pwd_context.hash(plaintext)


def verify_password(plaintext: str, stored_hash: str) -> bool:
    """Constant-time comparison via bcrypt. Returns False on malformed hash."""
    try:
        return _pwd_context.verify(plaintext, stored_hash)
    except Exception:
        return False
