"""fleets: members acting inside another account, drivers limited to their vehicles

Revision ID: 20261111_000024
Revises: 20261110_000023
Create Date: 2026-11-11 09:00:00

A fleet is an ordinary account (the owner) that other accounts are let into. The
owner's records, settings and subscription stay exactly where they were; a member
switches into the owner's workspace and the request then runs with
`app.user_id` = the owner, so every existing tenant policy applies unchanged.

* `fleet_members` — who is in whose fleet, as `manager` (everything the owner can do
  with the records) or `driver` (only the vehicles in `vehicle_ids`).
* `fleet_invitations` — pending invitations by email, accepted through a link or from
  inside the app by the account holding that (confirmed) address. Hashed tokens, as
  for password reset.
* `app.vehicle_ids` — a second session setting the vehicle-bound tenant tables now
  honour. Unset or empty means every vehicle of the tenant (owners, managers, the
  notification worker); a driver's request sets it to their assigned ids, so the
  database rather than each query keeps a driver to their own cars.
* `charging_sessions.recorded_by` / `expenses.recorded_by` — which person entered a
  record, once more than one person can. Defaulted from `app.actor_id`, which every
  request binds, so no insert has to name it.
"""

from __future__ import annotations

from alembic import op


revision = '20261111_000024'
down_revision = '20261110_000023'
branch_labels = None
depends_on = None

TENANT = "user_id = NULLIF(current_setting('app.user_id', true), '')::bigint"
# COALESCE inside the cast: OR does not promise to short-circuit, and ''::bigint[] fails.
SCOPE = (
    "(NULLIF(current_setting('app.vehicle_ids', true), '') IS NULL"
    " OR {column} = ANY(COALESCE(NULLIF(current_setting('app.vehicle_ids', true), ''), '{{}}')::bigint[]))"
)
VEHICLE_BOUND = {
    'vehicles': 'id',
    'charging_sessions': 'vehicle_id',
    'expenses': 'vehicle_id',
    'vehicle_events': 'vehicle_id',
    'recurring_expense_reminders': 'vehicle_id',
}


def _policy(table: str, predicate: str) -> None:
    op.execute(f'DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};')
    op.execute(f'CREATE POLICY {table}_tenant_isolation ON {table} USING ({predicate}) WITH CHECK ({predicate});')


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_members (
            id BIGSERIAL PRIMARY KEY,
            owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            member_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL CHECK (role IN ('manager', 'driver')),
            vehicle_ids BIGINT[] NOT NULL DEFAULT '{}',
            invited_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT fleet_members_unique UNIQUE (owner_id, member_id),
            CONSTRAINT fleet_members_not_self CHECK (owner_id <> member_id)
        );
        """
    )
    op.execute('CREATE INDEX IF NOT EXISTS fleet_members_member_idx ON fleet_members (member_id);')
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS fleet_invitations (
            id BIGSERIAL PRIMARY KEY,
            owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            role VARCHAR(20) NOT NULL CHECK (role IN ('manager', 'driver')),
            vehicle_ids BIGINT[] NOT NULL DEFAULT '{}',
            token_hash VARCHAR(128) NOT NULL UNIQUE,
            invited_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL,
            accepted_at TIMESTAMPTZ,
            accepted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
            revoked_at TIMESTAMPTZ
        );
        """
    )
    op.execute('CREATE INDEX IF NOT EXISTS fleet_invitations_email_idx ON fleet_invitations (lower(email));')

    for table in ('charging_sessions', 'expenses'):
        op.execute(f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL;')
        # Filled from the request's binding, so every insert path — the form, CSV
        # import, logging a recurring cost — records its author without passing it.
        op.execute(f"ALTER TABLE {table} ALTER COLUMN recorded_by SET DEFAULT NULLIF(current_setting('app.actor_id', true), '')::bigint;")

    for table, column in VEHICLE_BOUND.items():
        _policy(table, f'{TENANT} AND {SCOPE.format(column=column)}')

    # Membership: the owner manages it, the member reads (and leaves) their own row.
    # `app.actor_id` is the person signed in, set before the workspace is known.
    op.execute('ALTER TABLE fleet_members ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE fleet_members FORCE ROW LEVEL SECURITY;')
    _policy(
        'fleet_members',
        "owner_id = NULLIF(current_setting('app.user_id', true), '')::bigint"
        " OR member_id = NULLIF(current_setting('app.actor_id', true), '')::bigint",
    )
    # Invitations: the owner, plus `app.fleet_invite` for looking one up by its token or
    # by the invitee's address, which happens before the invitee belongs to anything.
    op.execute('ALTER TABLE fleet_invitations ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE fleet_invitations FORCE ROW LEVEL SECURITY;')
    _policy(
        'fleet_invitations',
        "owner_id = NULLIF(current_setting('app.user_id', true), '')::bigint"
        " OR current_setting('app.fleet_invite', true) = 'on'",
    )


def downgrade() -> None:
    for table in VEHICLE_BOUND:
        _policy(table, TENANT)
    for table in ('charging_sessions', 'expenses'):
        op.execute(f'ALTER TABLE {table} DROP COLUMN IF EXISTS recorded_by;')
    op.execute('DROP TABLE IF EXISTS fleet_invitations;')
    op.execute('DROP TABLE IF EXISTS fleet_members;')
