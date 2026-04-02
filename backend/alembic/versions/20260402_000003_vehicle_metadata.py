"""add optional vehicle metadata

Revision ID: 20260402_000003
Revises: 20260402_000002
Create Date: 2026-04-02 06:10:00
"""

from __future__ import annotations

from alembic import op


revision = '20260402_000003'
down_revision = '20260402_000002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS tank_capacity_liters NUMERIC(10,2);
        ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS starting_odometer_km NUMERIC(10,1);
        ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS color_hex VARCHAR(7);
        ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS notes TEXT;
        """
    )

    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_color_hex_chk') THEN
                ALTER TABLE vehicles
                    ADD CONSTRAINT vehicles_color_hex_chk
                    CHECK (color_hex IS NULL OR color_hex ~ '^#[0-9A-Fa-f]{6}$');
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_tank_capacity_chk') THEN
                ALTER TABLE vehicles
                    ADD CONSTRAINT vehicles_tank_capacity_chk
                    CHECK (tank_capacity_liters IS NULL OR tank_capacity_liters >= 0);
            END IF;

            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_starting_odometer_chk') THEN
                ALTER TABLE vehicles
                    ADD CONSTRAINT vehicles_starting_odometer_chk
                    CHECK (starting_odometer_km IS NULL OR starting_odometer_km >= 0);
            END IF;
        END $$;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_starting_odometer_chk;
        ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_tank_capacity_chk;
        ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_color_hex_chk;
        ALTER TABLE vehicles DROP COLUMN IF EXISTS notes;
        ALTER TABLE vehicles DROP COLUMN IF EXISTS color_hex;
        ALTER TABLE vehicles DROP COLUMN IF EXISTS starting_odometer_km;
        ALTER TABLE vehicles DROP COLUMN IF EXISTS tank_capacity_liters;
        """
    )