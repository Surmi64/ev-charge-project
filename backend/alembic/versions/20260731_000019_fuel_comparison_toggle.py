"""let the petrol comparison be switched off

Revision ID: 20260731_000019
Revises: 20260731_000018
Create Date: 2026-07-31 20:00:00

Until now the comparison appeared whenever a price could be found, and the only way to
be rid of the line was to have no price at all — which is not a setting, it is a side
effect. This is the explicit switch.

Defaults to TRUE so nothing changes for an account that already sees the line. An
account with no price still gets none: the switch decides whether the comparison is
wanted, not whether it is possible.
"""

from __future__ import annotations

from alembic import op


revision = '20260731_000019'
down_revision = '20260731_000018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS fuel_comparison_enabled BOOLEAN NOT NULL DEFAULT TRUE;')


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS fuel_comparison_enabled;')
