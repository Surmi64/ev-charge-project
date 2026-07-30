"""rename charging_sessions.cost_huf to cost_amount

Revision ID: 20260721_000011
Revises: 20260721_000010
Create Date: 2026-07-21 19:00:00

The column never held forints specifically — it held whatever the user typed. Now
that the currency is an account-level setting the name actively misleads.

Note that _km and _kwh suffixes elsewhere are left alone: those really are the
canonical storage units, and the client converts for display, so the suffix is
accurate and worth keeping.

PostgreSQL rewrites the dependent CHECK constraint expression on rename, so
charging_sessions_cost_chk keeps working under its existing name.
"""

from __future__ import annotations

from alembic import op


revision = '20260721_000011'
down_revision = '20260721_000010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'charging_sessions' AND column_name = 'cost_huf'
            ) THEN
                ALTER TABLE charging_sessions RENAME COLUMN cost_huf TO cost_amount;
            END IF;
        END
        $$;
    """)


def downgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name = 'charging_sessions' AND column_name = 'cost_amount'
            ) THEN
                ALTER TABLE charging_sessions RENAME COLUMN cost_amount TO cost_huf;
            END IF;
        END
        $$;
    """)
