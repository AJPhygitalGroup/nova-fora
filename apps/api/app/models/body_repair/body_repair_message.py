"""BodyRepairMessage — customer ↔ vendor thread per request.

System messages (state-change announcements) live here too. They
have author_id NULL and author_role='system'. Authored messages
have author_id + author_role in {'customer', 'vendor'} — the role
is cached at write time so the UI doesn't have to join users every
read.
"""
from datetime import datetime

import sqlalchemy as sa
from sqlalchemy import Column
from sqlmodel import Field, SQLModel

from app.models.base import timestamp_column, utc_now


class BodyRepairMessage(SQLModel, table=True):
    __tablename__ = "body_repair_messages"

    id: int | None = Field(default=None, primary_key=True)
    request_id: int = Field(
        sa_column=Column(
            "request_id",
            sa.Integer,
            sa.ForeignKey("body_repair_requests.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
    )
    # Nullable so system messages can be authorless.
    author_id: int | None = Field(
        default=None,
        sa_column=Column(
            "author_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # Cached role string: 'customer' | 'vendor' | 'system'. Stored as
    # plain VARCHAR(20) — not an enum — so it can grow without an
    # ALTER TYPE later.
    author_role: str = Field(max_length=20)
    body: str = Field(sa_column=Column("body", sa.Text, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=timestamp_column("created_at"),
    )

    @property
    def id_str(self) -> str:
        if self.id is None:
            return ""
        return f"BRM-{self.id:05d}"
