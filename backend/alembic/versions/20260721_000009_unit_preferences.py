"""per-user currency and unit preferences

Revision ID: 20260721_000009
Revises: 20260721_000008
Create Date: 2026-07-21 16:00:00

Distance and volume are stored canonically (kilometres, litres) and converted for
display, because those conversions are exact.

Currency is not converted. Changing it relabels future entries and leaves history
alone: turning a past invoice from one currency into another would need the
exchange rate on that transaction's date, and inventing one would put numbers in
the user's history that they never spent.
"""

from __future__ import annotations

from alembic import op


revision = '20260721_000009'
down_revision = '20260721_000008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'EUR';")
    op.execute("""
        ALTER TABLE users ADD COLUMN IF NOT EXISTS distance_unit VARCHAR(4) NOT NULL DEFAULT 'km';
    """)
    op.execute("""
        ALTER TABLE users ADD COLUMN IF NOT EXISTS volume_unit VARCHAR(8) NOT NULL DEFAULT 'l';
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_distance_unit_chk') THEN
                ALTER TABLE users ADD CONSTRAINT users_distance_unit_chk
                    CHECK (distance_unit IN ('km', 'mi'));
            END IF;
            IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_volume_unit_chk') THEN
                ALTER TABLE users ADD CONSTRAINT users_volume_unit_chk
                    CHECK (volume_unit IN ('l', 'gal_us', 'gal_uk'));
            END IF;
        END
        $$;
    """)

    # Existing accounts were all recording in HUF, so keep them there rather than
    # silently relabelling their history as euros.
    op.execute("UPDATE users SET currency = 'HUF' WHERE created_at < NOW();")


def downgrade() -> None:
    op.execute('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_distance_unit_chk;')
    op.execute('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_volume_unit_chk;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS currency;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS distance_unit;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS volume_unit;')
