"""record whether an electric vehicle has a heat pump

Revision ID: 20260730_000015
Revises: 20260730_000014
Create Date: 2026-07-30 22:30:00

Nullable on purpose, so the column has three states rather than two: TRUE, FALSE, and
"nobody has told us". A battery car's winter penalty is dominated by cabin heating,
and a heat pump roughly halves that part — so guessing FALSE for every existing
vehicle would push their forecasts the wrong way. NULL keeps them on the population
average until someone actually answers.
"""

from __future__ import annotations

from alembic import op


revision = '20260730_000015'
down_revision = '20260730_000014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS has_heat_pump BOOLEAN;')


def downgrade() -> None:
    op.execute('ALTER TABLE vehicles DROP COLUMN IF EXISTS has_heat_pump;')
