"""add recurring expense reminders

Revision ID: 20260402_000005
Revises: 20260402_000004
Create Date: 2026-04-02 08:05:00
"""

from __future__ import annotations

from alembic import op


revision = '20260402_000005'
down_revision = '20260402_000004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS recurring_expense_reminders (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,
            category VARCHAR(50) NOT NULL,
            amount NUMERIC(12,2) NOT NULL,
            currency VARCHAR(10) NOT NULL DEFAULT 'HUF',
            frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('monthly', 'quarterly', 'yearly')),
            next_due_date DATE NOT NULL,
            description TEXT,
            is_active BOOLEAN NOT NULL DEFAULT TRUE,
            last_logged_date DATE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT recurring_expense_amount_chk CHECK (amount >= 0)
        );

        CREATE INDEX IF NOT EXISTS recurring_expense_user_due_idx ON recurring_expense_reminders (user_id, is_active, next_due_date ASC);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS recurring_expense_user_due_idx;
        DROP TABLE IF EXISTS recurring_expense_reminders;
        """
    )