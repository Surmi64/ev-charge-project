"""two-step sign-in (TOTP) and refresh tokens held in a cookie

Revision ID: 20261112_000025
Revises: 20261111_000024
Create Date: 2026-11-12 09:00:00

* `users.totp_*` — the authenticator secret once confirmed, the one being set up until
  then, when it was switched on, and the last 30-second step accepted, so a code that
  has already signed someone in cannot be replayed inside its own window.
* `mfa_recovery_codes` — ten single-use codes per account, stored hashed like every
  other token here, for when the phone is gone.
* `user_sessions.previous_token_hash` / `rotated_at` — the refresh token now lives in an
  httpOnly cookie that every tab of the browser shares. A refresh whose response never
  arrives (a reload mid-request) would leave the browser holding the token the server
  had just retired; the previous one is therefore honoured for a short grace period
  and then forgotten.
"""

from __future__ import annotations

from alembic import op


revision = '20261112_000025'
down_revision = '20261111_000024'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(64);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_pending_secret VARCHAR(64);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at TIMESTAMPTZ;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_last_step BIGINT;

        CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_hash VARCHAR(64) NOT NULL,
            used_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS mfa_recovery_codes_user_idx ON mfa_recovery_codes (user_id);

        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS previous_token_hash VARCHAR(255);
        ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS rotated_at TIMESTAMPTZ;
        CREATE INDEX IF NOT EXISTS user_sessions_previous_token_hash_idx
            ON user_sessions (previous_token_hash) WHERE previous_token_hash IS NOT NULL;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS user_sessions_previous_token_hash_idx;
        ALTER TABLE user_sessions DROP COLUMN IF EXISTS rotated_at;
        ALTER TABLE user_sessions DROP COLUMN IF EXISTS previous_token_hash;
        DROP TABLE IF EXISTS mfa_recovery_codes;
        ALTER TABLE users DROP COLUMN IF EXISTS totp_last_step;
        ALTER TABLE users DROP COLUMN IF EXISTS totp_enabled_at;
        ALTER TABLE users DROP COLUMN IF EXISTS totp_pending_secret;
        ALTER TABLE users DROP COLUMN IF EXISTS totp_secret;
        """
    )
