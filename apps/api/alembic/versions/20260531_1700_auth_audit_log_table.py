"""auth_audit_log table — append-only record of login / logout / impersonate

Closes the "audit later" note from the real-impersonation commit
(d7fe052) and the logout commit (08510f9). Both events now persist a
row so site_admin can answer "who logged in / out / impersonated whom".

Revision ID: 20260531_1700
Revises: 20260527_1922
Create Date: 2026-05-31 17:00:00.000000+00:00
"""
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision: str = '20260531_1700'
down_revision: Union[str, None] = '20260527_1922'
branch_labels = None
depends_on = None


# CHECK constraint mirrors the AuthAuditEvent enum in
# app/models/auth_audit_log.py — keep in sync when adding events.
_EVENT_TYPES = ('login', 'logout', 'impersonate_start')


def upgrade() -> None:
    op.create_table(
        'auth_audit_log',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column(
            'event_type',
            sa.String(length=40),
            nullable=False,
        ),
        sa.Column(
            'actor_user_id',
            sa.Integer(),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column(
            'target_user_id',
            sa.Integer(),
            sa.ForeignKey('users.id', ondelete='SET NULL'),
            nullable=True,
        ),
        sa.Column('ip_address', sa.String(length=45), nullable=True),
        sa.Column('user_agent', sa.String(length=500), nullable=True),
        sa.Column(
            'extra',
            JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            'created_at',
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text('now()'),
        ),
        sa.CheckConstraint(
            "event_type IN " + str(_EVENT_TYPES),
            name='ck_auth_audit_log_event_type',
        ),
    )

    # Hot-path indexes — the typical query is "show me X's recent
    # activity" or "all impersonate events in the last 24h".
    op.create_index(
        'ix_auth_audit_log_event_type',
        'auth_audit_log',
        ['event_type'],
    )
    op.create_index(
        'ix_auth_audit_log_actor_user_id',
        'auth_audit_log',
        ['actor_user_id'],
    )
    op.create_index(
        'ix_auth_audit_log_target_user_id',
        'auth_audit_log',
        ['target_user_id'],
    )
    op.create_index(
        'ix_auth_audit_log_created_at',
        'auth_audit_log',
        ['created_at'],
    )


def downgrade() -> None:
    op.drop_index('ix_auth_audit_log_created_at', table_name='auth_audit_log')
    op.drop_index('ix_auth_audit_log_target_user_id', table_name='auth_audit_log')
    op.drop_index('ix_auth_audit_log_actor_user_id', table_name='auth_audit_log')
    op.drop_index('ix_auth_audit_log_event_type', table_name='auth_audit_log')
    op.drop_table('auth_audit_log')
