"""per-tenant row level security

Revision ID: 20260721_000007
Revises: 20260721_000006
Create Date: 2026-07-21 09:10:00

Isolation used to rest entirely on every query remembering `WHERE user_id = %s`.
This adds a database-level guarantee: the application connects as a dedicated
non-superuser role and every tenant table carries an RLS policy keyed on the
`app.user_id` setting, which get_tenant_db sets once per request.

Note the app role must NOT be a superuser and must not have BYPASSRLS, otherwise
the policies below are silently skipped.
"""

from __future__ import annotations

import os

from alembic import op


revision = '20260721_000007'
down_revision = '20260721_000006'
branch_labels = None
depends_on = None

# Tables holding per-user records. The auth tables (users, user_sessions,
# password_reset_tokens, auth_audit_logs) are deliberately excluded: login has to
# read them before any user identity exists.
TENANT_TABLES = [
    'vehicles',
    'charging_sessions',
    'expenses',
    'vehicle_events',
    'recurring_expense_reminders',
]

# subscriptions is billing metadata rather than user content, and admins must be able
# to see and change plan state to support customers. It therefore gets an extra escape
# on the `app.admin` setting, which only the admin endpoints turn on. The tables above
# deliberately have no such escape, so an admin cannot read anyone's vehicles or costs.
ADMIN_READABLE_TABLES = ['subscriptions']

APP_ROLE = os.environ.get('DB_APP_USER', 'garageos_app')
APP_PASSWORD = os.environ.get('DB_APP_PASS', 'garageos_app_password')


def upgrade() -> None:
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
                CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{APP_PASSWORD}'
                    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
            ELSE
                ALTER ROLE {APP_ROLE} NOSUPERUSER NOBYPASSRLS;
            END IF;
        END
        $$;
        """
    )

    op.execute(f'GRANT USAGE ON SCHEMA public TO {APP_ROLE};')
    op.execute(f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE};')
    op.execute(f'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE};')
    op.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE};')
    op.execute(f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO {APP_ROLE};')

    tenant_match = "user_id = NULLIF(current_setting('app.user_id', true), '')::bigint"
    admin_escape = "current_setting('app.admin', true) = 'on'"

    for table in TENANT_TABLES + ADMIN_READABLE_TABLES:
        predicate = tenant_match if table in TENANT_TABLES else f'({tenant_match} OR {admin_escape})'

        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;')
        # FORCE so the table owner is subject to the policy too. Superusers still
        # bypass it, which is why the app must not connect as one.
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY;')
        op.execute(f'DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};')
        # current_setting(..., true) returns NULL when unset, and NULL = anything is
        # NULL, so a request that forgets to set app.user_id sees zero rows rather
        # than every row.
        op.execute(
            f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
            USING ({predicate})
            WITH CHECK ({predicate});
            """
        )


def downgrade() -> None:
    for table in TENANT_TABLES + ADMIN_READABLE_TABLES:
        op.execute(f'DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};')
        op.execute(f'ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY;')
        op.execute(f'ALTER TABLE {table} DISABLE ROW LEVEL SECURITY;')
