"""record which climate zone an account drives in

Revision ID: 20260731_000016
Revises: 20260730_000015
Create Date: 2026-07-31 09:00:00

Nullable, and deliberately not defaulted to the temperate zone the forecast falls back
to. The two states differ: an account that has answered "temperate continental" and one
that has never been asked produce the same forecast today, but only the second should
be prompted to fix it. Without that distinction a southern-hemisphere account would sit
on an inverted seasonal curve with nothing to tell it so.

No CHECK constraint on the value. The zone list lives in backend/climate.py and will
grow; a constraint here would mean a migration every time it does, and an unrecognised
value already resolves to the default in climate.resolve_zone.
"""

from __future__ import annotations

from alembic import op


revision = '20260731_000016'
down_revision = '20260730_000015'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS climate_zone VARCHAR(32);')


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS climate_zone;')
