"""remember which dashboard alerts a user dismissed

Revision ID: 20260721_000008
Revises: 20260721_000007
Create Date: 2026-07-21 12:00:00

Stored per user rather than in localStorage so the choice follows the account
across devices, matching how theme_mode already works.
"""

from __future__ import annotations

from alembic import op


revision = '20260721_000008'
down_revision = '20260721_000007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS dismissed_alerts JSONB NOT NULL DEFAULT '[]'::jsonb;"
    )


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS dismissed_alerts;')
