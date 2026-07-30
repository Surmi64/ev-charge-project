"""track whether an account has been through onboarding

Revision ID: 20260721_000010
Revises: 20260721_000009
Create Date: 2026-07-21 18:00:00

A timestamp rather than a boolean: it answers "have we asked?" and also records
when, which is useful later for seeing where people drop out. Skipping counts as
done — the point of a skip is that we stop asking.
"""

from __future__ import annotations

from alembic import op


revision = '20260721_000010'
down_revision = '20260721_000009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarded_at TIMESTAMPTZ;')
    # Existing accounts already have vehicles and records; walking them through a
    # setup wizard now would be noise.
    op.execute('UPDATE users SET onboarded_at = NOW() WHERE onboarded_at IS NULL;')


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS onboarded_at;')
