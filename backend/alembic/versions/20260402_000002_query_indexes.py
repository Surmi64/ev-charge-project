"""add query pattern indexes

Revision ID: 20260402_000002
Revises: 20260402_000001
Create Date: 2026-04-02 04:45:00
"""

from __future__ import annotations

from alembic import op


revision = '20260402_000002'
down_revision = '20260402_000001'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS user_sessions_user_revoked_expires_idx ON user_sessions (user_id, revoked_at, expires_at DESC);
        CREATE INDEX IF NOT EXISTS auth_audit_logs_email_created_at_idx ON auth_audit_logs (LOWER(email), created_at DESC);
        CREATE INDEX IF NOT EXISTS password_reset_tokens_user_status_expires_idx ON password_reset_tokens (user_id, used_at, expires_at DESC);
        CREATE INDEX IF NOT EXISTS vehicles_user_default_created_idx ON vehicles (user_id, is_default, created_at DESC);
        CREATE INDEX IF NOT EXISTS expenses_user_vehicle_date_idx ON expenses (user_id, vehicle_id, date DESC);
        CREATE INDEX IF NOT EXISTS charging_sessions_user_vehicle_type_start_idx ON charging_sessions (user_id, vehicle_id, session_type, start_time DESC);
        CREATE INDEX IF NOT EXISTS vehicle_events_user_event_type_date_idx ON vehicle_events (user_id, event_type, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS vehicle_events_user_vehicle_date_idx ON vehicle_events (user_id, vehicle_id, occurred_at DESC);
        CREATE INDEX IF NOT EXISTS vehicle_events_expense_category_date_idx ON vehicle_events (expense_category, occurred_at DESC) WHERE expense_category IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS vehicle_events_expense_category_date_idx;
        DROP INDEX IF EXISTS vehicle_events_user_vehicle_date_idx;
        DROP INDEX IF EXISTS vehicle_events_user_event_type_date_idx;
        DROP INDEX IF EXISTS charging_sessions_user_vehicle_type_start_idx;
        DROP INDEX IF EXISTS expenses_user_vehicle_date_idx;
        DROP INDEX IF EXISTS vehicles_user_default_created_idx;
        DROP INDEX IF EXISTS password_reset_tokens_user_status_expires_idx;
        DROP INDEX IF EXISTS auth_audit_logs_email_created_at_idx;
        DROP INDEX IF EXISTS user_sessions_user_revoked_expires_idx;
        """
    )