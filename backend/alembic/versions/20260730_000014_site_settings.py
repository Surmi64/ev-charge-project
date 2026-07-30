"""admin-editable site settings

Revision ID: 20260730_000014
Revises: 20260722_000013
Create Date: 2026-07-30 21:00:00

Key/value rather than one row of columns: the whole point is that the set grows, and
adding a setting should not mean a migration every time. JSONB keeps types honest —
a boolean stays a boolean rather than becoming the string 'false', which is truthy.

Deliberately not under row level security. Every other table here is tenant data keyed
by user_id; this is one global row set that admins write and the app reads while
serving anyone, including during registration when no identity exists yet.
"""

from __future__ import annotations

import os

from alembic import op


revision = '20260730_000014'
down_revision = '20260722_000013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS site_settings (
            key VARCHAR(64) PRIMARY KEY,
            value JSONB NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL
        );
        """
    )
    # The app role normally inherits these from ALTER DEFAULT PRIVILEGES, but only for
    # objects created by the role that set them. Granting explicitly means the table
    # works whichever role ran the migration. Skipped when the role is absent, so a
    # single-role local database still migrates.
    app_role = os.environ.get('DB_APP_USER', 'mileage_app').strip() or 'mileage_app'
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{app_role}') THEN
                EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON site_settings TO {app_role}';
            END IF;
        END
        $$;
        """
    )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS site_settings;')
