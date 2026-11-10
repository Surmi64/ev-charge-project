"""let cost per 100 km leave out the costs that are not driving

Revision ID: 20261105_000021
Revises: 20260802_000020
Create Date: 2026-11-05 12:00:00

Cost per 100 km used to divide everything spent -- insurance, tax, servicing -- by the
distance driven. A quarterly insurance bill then turned whichever month it landed in
into the most expensive kilometres of the year, which says nothing about driving. The
figure now covers charging and fuel unless the account asks for every cost.

Defaults to FALSE: the narrower figure is the one the line can be read against month
to month, and the petrol comparison beside it is fuel only as well.
"""

from __future__ import annotations

from alembic import op


revision = '20261105_000021'
down_revision = '20260802_000020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS cost_per_km_includes_expenses BOOLEAN NOT NULL DEFAULT FALSE;')


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS cost_per_km_includes_expenses;')
