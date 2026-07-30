"""rename the application database role to mileage_app

Revision ID: 20260721_000012
Revises: 20260721_000011
Create Date: 2026-07-21 20:00:00

Follows the product rename. ALTER ROLE ... RENAME keeps every grant and ownership
intact, so no privileges need re-issuing.

The role's password is not carried over by a rename, so it is set again here.
Deployments must update DB_APP_USER at the same time; the old name stops existing
the moment this runs.
"""

from __future__ import annotations

import os

from alembic import op


revision = '20260721_000012'
down_revision = '20260721_000011'
branch_labels = None
depends_on = None

OLD_ROLE = 'garageos_app'
NEW_ROLE = os.environ.get('DB_APP_USER', 'mileage_app')
NEW_PASSWORD = os.environ.get('DB_APP_PASS', 'mileage_app_password')


def upgrade() -> None:
    op.execute(f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{OLD_ROLE}')
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{NEW_ROLE}') THEN
                ALTER ROLE {OLD_ROLE} RENAME TO {NEW_ROLE};
            ELSIF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{NEW_ROLE}') THEN
                CREATE ROLE {NEW_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
            END IF;

            -- A rename drops the stored password, and the role must never gain
            -- superuser or BYPASSRLS or the tenant policies stop applying.
            EXECUTE format('ALTER ROLE {NEW_ROLE} LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', '{NEW_PASSWORD}');
        END
        $$;
    """)

    op.execute(f'GRANT USAGE ON SCHEMA public TO {NEW_ROLE};')
    op.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {NEW_ROLE};')
    op.execute(f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {NEW_ROLE};')
    op.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {NEW_ROLE};')
    op.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {NEW_ROLE};')


def downgrade() -> None:
    op.execute(f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{NEW_ROLE}')
               AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{OLD_ROLE}') THEN
                ALTER ROLE {NEW_ROLE} RENAME TO {OLD_ROLE};
                EXECUTE format('ALTER ROLE {OLD_ROLE} LOGIN PASSWORD %L', 'garageos_app_password');
            END IF;
        END
        $$;
    """)
