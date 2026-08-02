"""let an account pick which colour palette it sees

Revision ID: 20260802_000020
Revises: 20260731_000019
Create Date: 2026-08-02 12:00:00

theme_mode already decides light or dark. This decides which hues those modes are
built from, so the two are orthogonal: every palette ships both a light and a dark
set, and switching one does not disturb the other.

Deliberately no CHECK constraint, unlike theme_mode. The list of palettes lives in
the client (frontend/src/utils/palette.js) and will grow; a constraint here would
mean a migration for every new look, and an account that somehow stored an unknown
id falls back to the default on read rather than failing. The API still validates
against the known set on write — this column is the store, not the gate.
"""

from __future__ import annotations

from alembic import op


revision = '20260802_000020'
down_revision = '20260731_000019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS "
        "theme_palette VARCHAR(40) NOT NULL DEFAULT 'midnight-grove';"
    )


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS theme_palette;')
