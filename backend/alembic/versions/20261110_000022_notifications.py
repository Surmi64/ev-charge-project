"""email a list of recipients when a charge or fill-up is recorded

Revision ID: 20261110_000022
Revises: 20261105_000021
Create Date: 2026-11-10 12:00:00

`notification_recipients` is who hears about new records on an account: the owner, a
fleet manager, a bookkeeper. Each picks instant mail or a daily or weekly digest, and
optionally only some vehicles. An address other than the account's own has to confirm
before anything is sent to it, so the service cannot be pointed at a stranger's inbox.

`notification_outbox` is the queue between the request and the mail server. Saving a
charge only writes a row here; a background worker sends it, retries it, and records
what happened. A mail server that is slow or down therefore never slows or fails the
save itself.

Both tables follow the tenant policy, plus an `app.notifications` escape like the
`app.admin` one on subscriptions: the worker drains the queue for every account at
once, and the confirm / unsubscribe links are opened by people with no session.
"""

from __future__ import annotations

from alembic import op


revision = '20261110_000022'
down_revision = '20261105_000021'
branch_labels = None
depends_on = None

TABLES = ('notification_recipients', 'notification_outbox')


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_recipients (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            mode VARCHAR(10) NOT NULL DEFAULT 'instant',
            vehicle_ids BIGINT[],
            confirmed_at TIMESTAMPTZ,
            confirm_token_hash VARCHAR(64),
            confirm_sent_at TIMESTAMPTZ,
            unsubscribe_token VARCHAR(64) NOT NULL,
            last_digest_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT notification_recipients_mode_chk CHECK (mode IN ('instant', 'daily', 'weekly'))
        );
        """
    )
    op.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS notification_recipients_user_email_uidx '
        'ON notification_recipients (user_id, LOWER(email));'
    )
    op.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS notification_recipients_unsubscribe_uidx '
        'ON notification_recipients (unsubscribe_token);'
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS notification_outbox (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            recipient_id BIGINT REFERENCES notification_recipients(id) ON DELETE CASCADE,
            kind VARCHAR(20) NOT NULL,
            payload JSONB NOT NULL,
            status VARCHAR(10) NOT NULL DEFAULT 'pending',
            attempts SMALLINT NOT NULL DEFAULT 0,
            last_error TEXT,
            send_after TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            sent_at TIMESTAMPTZ,
            CONSTRAINT notification_outbox_kind_chk CHECK (kind IN ('session', 'digest', 'confirm', 'test')),
            CONSTRAINT notification_outbox_status_chk CHECK (status IN ('pending', 'sent', 'failed'))
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx "
        "ON notification_outbox (send_after) WHERE status = 'pending';"
    )

    predicate = (
        "user_id = NULLIF(current_setting('app.user_id', true), '')::bigint"
        " OR current_setting('app.notifications', true) = 'on'"
    )
    for table in TABLES:
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;')
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY;')
        op.execute(f'DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};')
        op.execute(
            f"""
            CREATE POLICY {table}_tenant_isolation ON {table}
            USING ({predicate})
            WITH CHECK ({predicate});
            """
        )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS notification_outbox;')
    op.execute('DROP TABLE IF EXISTS notification_recipients;')
