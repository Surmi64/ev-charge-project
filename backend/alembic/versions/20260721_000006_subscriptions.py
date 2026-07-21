"""add subscriptions with a 30 day trial

Revision ID: 20260721_000006
Revises: 20260402_000005
Create Date: 2026-07-21 09:00:00
"""

from __future__ import annotations

from alembic import op


revision = '20260721_000006'
down_revision = '20260402_000005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS subscriptions (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
            plan VARCHAR(20) NOT NULL DEFAULT 'trial'
                CHECK (plan IN ('trial', 'monthly', 'yearly')),
            status VARCHAR(20) NOT NULL DEFAULT 'trialing'
                CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
            trial_ends_at TIMESTAMPTZ,
            current_period_start TIMESTAMPTZ,
            current_period_end TIMESTAMPTZ,
            cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
            -- Filled in once a payment provider is wired up; unused for now.
            provider VARCHAR(30),
            provider_customer_id VARCHAR(120),
            provider_subscription_id VARCHAR(120),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
    op.execute('CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON subscriptions (user_id);')
    op.execute('CREATE INDEX IF NOT EXISTS subscriptions_status_idx ON subscriptions (status, current_period_end);')

    # Existing accounts start a fresh 30 day trial rather than being locked out.
    op.execute(
        """
        INSERT INTO subscriptions (user_id, plan, status, trial_ends_at)
        SELECT u.id, 'trial', 'trialing', NOW() + INTERVAL '30 days'
        FROM users u
        ON CONFLICT (user_id) DO NOTHING;
        """
    )


def downgrade() -> None:
    op.execute('DROP TABLE IF EXISTS subscriptions;')
