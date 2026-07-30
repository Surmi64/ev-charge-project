"""add hydrogen as a fuel type

Revision ID: 20260722_000013
Revises: 20260721_000012
Create Date: 2026-07-22 10:00:00

Hydrogen fuel-cell vehicles refuel like combustion cars (a quick fill, not a slow
charge), so they go down the 'fueling' path. The one wrinkle is that hydrogen is
sold by the kilogram, not the litre — that is handled in the UI, since fuel_liters
is just a numeric quantity as far as the schema is concerned.
"""

from __future__ import annotations

from alembic import op


revision = '20260722_000013'
down_revision = '20260721_000012'
branch_labels = None
depends_on = None

FUEL_TYPES = ('electric', 'hybrid', 'petrol', 'diesel', 'hydrogen')


def upgrade() -> None:
    values = ', '.join(f"'{v}'" for v in FUEL_TYPES)
    op.execute('ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_fuel_type_check;')
    op.execute(f'ALTER TABLE vehicles ADD CONSTRAINT vehicles_fuel_type_check CHECK (fuel_type IN ({values}));')


def downgrade() -> None:
    op.execute("UPDATE vehicles SET fuel_type = 'petrol' WHERE fuel_type = 'hydrogen';")
    op.execute('ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_fuel_type_check;')
    op.execute(
        "ALTER TABLE vehicles ADD CONSTRAINT vehicles_fuel_type_check "
        "CHECK (fuel_type IN ('electric', 'hybrid', 'petrol', 'diesel'));"
    )
