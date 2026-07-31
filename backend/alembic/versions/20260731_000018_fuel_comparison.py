"""reference figures for the "what would petrol have cost" comparison

Revision ID: 20260731_000018
Revises: 20260731_000017
Create Date: 2026-07-31 18:00:00

Two numbers the account cannot derive for itself once it has stopped burning fuel: how
much a combustion car would have used over the same distance, and what that fuel costs.

Both nullable, and both mean "not answered" rather than a default. A made-up fuel price
is worse than no line at all — it varies by an order of magnitude across the currencies
this app supports, and a comparison drawn from an invented number would look exactly as
authoritative as one drawn from a real one. Where the account has its own fuelling
records, the price is taken from those instead and this column stays empty.

Consumption is stored per 100 km to match the canonical distance unit, in the same way
distances are stored in kilometres and converted for display.
"""

from __future__ import annotations

from alembic import op


revision = '20260731_000018'
down_revision = '20260731_000017'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS reference_consumption_l_100km NUMERIC(4,1);')
    # Per litre, in the account's own currency — which is a label, never converted, so
    # this figure means whatever the rest of that account's money means.
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS reference_fuel_price NUMERIC(10,2);')
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_reference_consumption_chk') THEN
                ALTER TABLE users ADD CONSTRAINT users_reference_consumption_chk
                    CHECK (reference_consumption_l_100km IS NULL
                           OR reference_consumption_l_100km BETWEEN 1 AND 50);
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_reference_fuel_price_chk') THEN
                ALTER TABLE users ADD CONSTRAINT users_reference_fuel_price_chk
                    CHECK (reference_fuel_price IS NULL OR reference_fuel_price > 0);
            END IF;
        END $$;
    """)


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_reference_fuel_price_chk;')
    op.execute('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_reference_consumption_chk;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS reference_fuel_price;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS reference_consumption_l_100km;')
