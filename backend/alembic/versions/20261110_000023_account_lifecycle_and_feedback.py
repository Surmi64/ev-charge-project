"""account lifecycle (verification, sessions, deletion, terms) and feedback

Revision ID: 20261110_000023
Revises: 20261110_000022
Create Date: 2026-11-10 18:00:00

What a public launch needs around an account, beyond logging in:

* `email_verification_tokens` — proof that an address is the account holder's, for
  sign-up and for a changed address. Hashed like the reset tokens.
* `user_sessions.user_agent` / `ip_address` — so the account can see where it is
  signed in and end a session it does not recognise.
* `users.terms_accepted_at` / `terms_version` — which terms a sign-up agreed to.
* `users.deletion_scheduled_for` — self-service deletion waits 30 days, so a mistake or
  a hijacked session is recoverable; the worker purges once the date passes.
* `users.lifecycle_emails` — keys of one-off mails already sent (trial reminders), so a
  restart never sends one twice.
* `rate_limit_events` — attempts per key, in the database rather than in process
  memory, so a restart no longer resets the login limit and a second worker shares it.
* `feedback` / `feedback_messages` — ideas, bug reports and complaints, with the reply
  thread. Tenant policy plus the `app.admin` escape, as on subscriptions: the admin
  inbox has to read every account's submissions.
* `notification_outbox` gains a 'system' kind with no recipient row: account mail
  (verification, reset, deletion notices) goes to an address, not a subscriber.
"""

from __future__ import annotations

from alembic import op


revision = '20261110_000023'
down_revision = '20261110_000022'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;')
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_version VARCHAR(20);')
    op.execute('ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_scheduled_for TIMESTAMPTZ;')
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS lifecycle_emails JSONB NOT NULL DEFAULT '[]'::jsonb;")

    op.execute('ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent VARCHAR(255);')
    op.execute('ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ip_address VARCHAR(64);')

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            email VARCHAR(255) NOT NULL,
            token_hash VARCHAR(255) NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute('CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_hash_uidx ON email_verification_tokens (token_hash);')
    op.execute('CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx ON email_verification_tokens (user_id, created_at DESC);')

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS rate_limit_events (
            id BIGSERIAL PRIMARY KEY,
            key VARCHAR(255) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute('CREATE INDEX IF NOT EXISTS rate_limit_events_key_idx ON rate_limit_events (key, created_at DESC);')

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS feedback (
            id BIGSERIAL PRIMARY KEY,
            -- SET NULL, not CASCADE: a complaint and its answer must outlive the account
            -- (the purge deletes ideas and bug reports itself). contact_email keeps who it was.
            user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            contact_email VARCHAR(255),
            kind VARCHAR(20) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'new',
            subject VARCHAR(200) NOT NULL,
            body TEXT NOT NULL,
            context JSONB NOT NULL DEFAULT '{}'::jsonb,
            due_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT feedback_kind_chk CHECK (kind IN ('idea', 'bug', 'complaint')),
            CONSTRAINT feedback_status_chk CHECK (status IN ('new', 'in_progress', 'planned', 'answered', 'resolved', 'declined'))
        );
        """
    )
    op.execute('CREATE INDEX IF NOT EXISTS feedback_user_idx ON feedback (user_id, created_at DESC);')
    op.execute('CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at DESC);')
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS feedback_messages (
            id BIGSERIAL PRIMARY KEY,
            feedback_id BIGINT NOT NULL REFERENCES feedback(id) ON DELETE CASCADE,
            user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            from_admin BOOLEAN NOT NULL DEFAULT FALSE,
            body TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute('CREATE INDEX IF NOT EXISTS feedback_messages_feedback_idx ON feedback_messages (feedback_id, created_at);')

    predicate = (
        "user_id = NULLIF(current_setting('app.user_id', true), '')::bigint"
        " OR current_setting('app.admin', true) = 'on'"
    )
    for table in ('feedback', 'feedback_messages'):
        op.execute(f'ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;')
        op.execute(f'ALTER TABLE {table} FORCE ROW LEVEL SECURITY;')
        op.execute(f'DROP POLICY IF EXISTS {table}_tenant_isolation ON {table};')
        op.execute(f'CREATE POLICY {table}_tenant_isolation ON {table} USING ({predicate}) WITH CHECK ({predicate});')

    op.execute('ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_chk;')
    op.execute(
        "ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_kind_chk "
        "CHECK (kind IN ('session', 'digest', 'confirm', 'test', 'system'));"
    )


def downgrade() -> None:
    op.execute("DELETE FROM notification_outbox WHERE kind = 'system';")
    op.execute('ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_kind_chk;')
    op.execute(
        "ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_kind_chk "
        "CHECK (kind IN ('session', 'digest', 'confirm', 'test'));"
    )
    op.execute('DROP TABLE IF EXISTS feedback_messages;')
    op.execute('DROP TABLE IF EXISTS feedback;')
    op.execute('DROP TABLE IF EXISTS rate_limit_events;')
    op.execute('DROP TABLE IF EXISTS email_verification_tokens;')
    op.execute('ALTER TABLE user_sessions DROP COLUMN IF EXISTS ip_address;')
    op.execute('ALTER TABLE user_sessions DROP COLUMN IF EXISTS user_agent;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS lifecycle_emails;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS deletion_scheduled_for;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS terms_version;')
    op.execute('ALTER TABLE users DROP COLUMN IF EXISTS terms_accepted_at;')
