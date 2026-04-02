"""add vehicle archiving support

Revision ID: 20260402_000004
Revises: 20260402_000003
Create Date: 2026-04-02 07:10:00
"""

from __future__ import annotations

from alembic import op


revision = '20260402_000004'
down_revision = '20260402_000003'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
        CREATE INDEX IF NOT EXISTS vehicles_user_id_archived_idx ON vehicles (user_id, is_archived);
        DROP INDEX IF EXISTS vehicles_one_default_per_user_uidx;
        CREATE UNIQUE INDEX IF NOT EXISTS vehicles_one_default_per_user_uidx ON vehicles (user_id) WHERE is_default = TRUE AND is_archived = FALSE;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP INDEX IF EXISTS vehicles_user_id_archived_idx;
        DROP INDEX IF EXISTS vehicles_one_default_per_user_uidx;
        CREATE UNIQUE INDEX IF NOT EXISTS vehicles_one_default_per_user_uidx ON vehicles (user_id) WHERE is_default = TRUE;
        ALTER TABLE vehicles DROP COLUMN IF EXISTS is_archived;
        """
    )