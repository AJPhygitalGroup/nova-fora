"""Password hashing with bcrypt.

We use the `bcrypt` library directly (not passlib) because passlib 1.7.4 is
incompatible with bcrypt>=4.1 — its internal self-test sends a too-long
password and crashes with 'password cannot be longer than 72 bytes'.

bcrypt >= 4 enforces the 72-byte limit strictly. We truncate silently on
input (standard practice — users with >72-byte passwords will still be able
to verify, as long as the first 72 bytes are consistent).
"""
import bcrypt

# Cost factor: 12 rounds (~250ms on a modern VPS). OWASP recommended minimum.
_ROUNDS = 12
_MAX_BYTES = 72  # bcrypt hard limit


def _truncate(plaintext: str) -> bytes:
    """Encode to UTF-8 and truncate to 72 bytes (bcrypt's hard limit)."""
    return plaintext.encode("utf-8")[:_MAX_BYTES]


def hash_password(plaintext: str) -> str:
    """Return a bcrypt hash (utf-8 str). Uses cost factor 12."""
    salt = bcrypt.gensalt(rounds=_ROUNDS)
    return bcrypt.hashpw(_truncate(plaintext), salt).decode("utf-8")


def verify_password(plaintext: str, stored_hash: str) -> bool:
    """Constant-time comparison. Returns False on malformed hash."""
    try:
        return bcrypt.checkpw(_truncate(plaintext), stored_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False
