"""remember where a charge or a fill-up happened

Revision ID: 20260731_000017
Revises: 20260731_000016
Create Date: 2026-07-31 15:00:00

Two levels, because they answer different questions.

`places` is a named spot the account keeps going back to — "MOL Váci út", "Otthon".
Naming it once has to be enough, which is why it is a table rather than a text column
repeated on every session: renaming a station would otherwise mean editing every record
ever filed against it.

The coordinates on `charging_sessions` are the *actual* reading taken at that visit,
which is never quite the same twice — a phone parked at the same pump reports points
tens of metres apart. Keeping both means the place can be re-clustered later without
having lost the raw observations, and a visit whose fix was too poor to match anything
is still recorded rather than thrown away.

Everything is nullable. Location is opt-in, existing records have none, and a session
saved without it must stay exactly as valid as one saved with it.

No PostGIS. Matching is a bounding box on the (user_id, latitude, longitude) index
followed by a haversine in Python over the handful of rows that survive it, which for
the number of places one person accumulates is not worth an extension for.
"""

from __future__ import annotations

from alembic import op


revision = '20260731_000017'
down_revision = '20260731_000016'
branch_labels = None
depends_on = None

# NUMERIC(9,6) is about 11 cm at the equator — far finer than any phone fix, and it
# bounds the stored precision so a raw GPS reading cannot become a de facto tracking log
# with more resolution than the feature needs.
COORD = 'NUMERIC(9,6)'


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TABLE IF NOT EXISTS places (
            id BIGSERIAL PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(120) NOT NULL,
            latitude {COORD} NOT NULL,
            longitude {COORD} NOT NULL,
            visit_count INTEGER NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT places_latitude_chk CHECK (latitude BETWEEN -90 AND 90),
            CONSTRAINT places_longitude_chk CHECK (longitude BETWEEN -180 AND 180)
        );
        """
    )
    # The bounding-box prefilter reads this; user_id first because every query is
    # already confined to one account.
    op.execute('CREATE INDEX IF NOT EXISTS places_user_coords_idx ON places (user_id, latitude, longitude);')
    op.execute('CREATE UNIQUE INDEX IF NOT EXISTS places_user_name_uidx ON places (user_id, LOWER(name));')

    op.execute(f'ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS latitude {COORD};')
    op.execute(f'ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS longitude {COORD};')
    # Metres, as the browser reports it. Worth storing: a 2 km fix and a 5 m fix are
    # both "a location", and only one of them should be allowed to name a petrol station.
    op.execute('ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS location_accuracy_m NUMERIC(8,1);')
    op.execute('ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS place_id BIGINT REFERENCES places(id) ON DELETE SET NULL;')
    op.execute('CREATE INDEX IF NOT EXISTS charging_sessions_place_idx ON charging_sessions (place_id) WHERE place_id IS NOT NULL;')

    # The read model carries the resolved name rather than a join, in the same spirit as
    # the rest of vehicle_events: Records renders straight from one row.
    op.execute(f'ALTER TABLE vehicle_events ADD COLUMN IF NOT EXISTS latitude {COORD};')
    op.execute(f'ALTER TABLE vehicle_events ADD COLUMN IF NOT EXISTS longitude {COORD};')
    op.execute('ALTER TABLE vehicle_events ADD COLUMN IF NOT EXISTS place_name VARCHAR(120);')

    # Same isolation as every other tenant table, and for the same reason: a places row
    # is a list of somewhere a person actually goes.
    predicate = "user_id = NULLIF(current_setting('app.user_id', true), '')::bigint"
    op.execute('ALTER TABLE places ENABLE ROW LEVEL SECURITY;')
    op.execute('ALTER TABLE places FORCE ROW LEVEL SECURITY;')
    op.execute('DROP POLICY IF EXISTS places_tenant_isolation ON places;')
    op.execute(
        f"""
        CREATE POLICY places_tenant_isolation ON places
        USING ({predicate})
        WITH CHECK ({predicate});
        """
    )


def downgrade() -> None:
    op.execute('ALTER TABLE vehicle_events DROP COLUMN IF EXISTS place_name;')
    op.execute('ALTER TABLE vehicle_events DROP COLUMN IF EXISTS longitude;')
    op.execute('ALTER TABLE vehicle_events DROP COLUMN IF EXISTS latitude;')
    op.execute('ALTER TABLE charging_sessions DROP COLUMN IF EXISTS place_id;')
    op.execute('ALTER TABLE charging_sessions DROP COLUMN IF EXISTS location_accuracy_m;')
    op.execute('ALTER TABLE charging_sessions DROP COLUMN IF EXISTS longitude;')
    op.execute('ALTER TABLE charging_sessions DROP COLUMN IF EXISTS latitude;')
    op.execute('DROP POLICY IF EXISTS places_tenant_isolation ON places;')
    op.execute('DROP TABLE IF EXISTS places;')
