#!/usr/bin/env bash
#
# Import the legacy ev-charge charging history into a Mileage database.
#
# The old stack (ev_postgres on the dev host, PostgreSQL 15) holds a single
# vehicle's charging sessions in a flat `charging_sessions` table with no user
# column. This pulls those rows and maps them onto the multi-tenant schema:
# one vehicle under one account, sessions marked with a `legacy_` source prefix.
#
# Re-running is safe: rows carrying a `legacy_` source for the target vehicle are
# replaced, and nothing else is touched. The legacy database is only ever read.
#
#   bash scripts/import-legacy-evcharge.sh                    # dev host -> local stack
#   CSV_FILE=/path/to/legacy.csv bash scripts/...             # skip the ssh fetch
#   TARGET_CONTAINER=garageos-postgres-dev SSH_TARGET=1 ...    # import on the dev host
#
set -euo pipefail

SSH_HOST=${SSH_HOST:-server-proxmox}
LEGACY_CONTAINER=${LEGACY_CONTAINER:-ev_postgres}
TARGET_CONTAINER=${TARGET_CONTAINER:-mileage-postgres-dev}
# Set to 1 when the target container lives on SSH_HOST rather than locally.
SSH_TARGET=${SSH_TARGET:-0}

DB_USER=${DB_USER:-ev_user}
DB_NAME=${DB_NAME:-ev_charger}

# Which account and vehicle the history lands on.
TARGET_USER_ID=${TARGET_USER_ID:-1}
PLATE=${PLATE:-SSA511}
VEHICLE_NAME=${VEHICLE_NAME:-Zoe}
VEHICLE_MAKE=${VEHICLE_MAKE:-Renault}
VEHICLE_MODEL=${VEHICLE_MODEL:-Zoe}
BATTERY_KWH=${BATTERY_KWH:-52.00}

CSV_FILE=${CSV_FILE:-}

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT

target_psql() {
  if [ "$SSH_TARGET" = "1" ]; then
    ssh "$SSH_HOST" "docker exec -i $TARGET_CONTAINER psql -U $DB_USER -d $DB_NAME $*"
  else
    docker exec -i "$TARGET_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" "$@"
  fi
}

# ---------------------------------------------------------------------------
# 1. Read the legacy rows
# ---------------------------------------------------------------------------

LEGACY_QUERY="
SELECT
    id,
    start_time,
    end_time,
    kwh,
    cost_huf,
    odometer,
    coalesce(notes, '')    AS notes,
    coalesce(provider, '') AS provider,
    coalesce(city, '')     AS city,
    coalesce(ac_or_dc, '') AS ac_or_dc,
    coalesce(kw, '')       AS kw,
    source,
    created_at
FROM charging_sessions
ORDER BY start_time"

if [ -n "$CSV_FILE" ]; then
  echo "Using CSV: $CSV_FILE"
  cp "$CSV_FILE" "$WORKDIR/legacy.csv"
else
  echo "Reading $LEGACY_CONTAINER on $SSH_HOST (read-only)..."
  ssh "$SSH_HOST" \
    "docker exec $LEGACY_CONTAINER psql -U $DB_USER -d $DB_NAME --csv -c \"$LEGACY_QUERY\"" \
    > "$WORKDIR/legacy.csv"
fi

ROWS=$(($(wc -l < "$WORKDIR/legacy.csv") - 1))
if [ "$ROWS" -lt 1 ]; then
  echo "No legacy rows found — aborting." >&2
  exit 1
fi
echo "Legacy rows: $ROWS"

# ---------------------------------------------------------------------------
# 2. Which cost column does the target have?
# ---------------------------------------------------------------------------
# Migration 20260721_000011 renamed cost_huf to cost_amount. The dev host's
# garageos stack predates it, so both names are still in circulation.

COST_COL=$(target_psql -At -c "
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'charging_sessions' AND column_name IN ('cost_amount', 'cost_huf')
  ORDER BY column_name LIMIT 1" | tr -d '\r')

if [ -z "$COST_COL" ]; then
  echo "Target charging_sessions has neither cost_amount nor cost_huf — wrong database?" >&2
  exit 1
fi
echo "Target cost column: $COST_COL"

# ---------------------------------------------------------------------------
# 3. Import
# ---------------------------------------------------------------------------
# RLS is FORCE'd on every tenant table, so the owner role is subject to the
# policies too — app.user_id has to be set or every statement matches nothing.

{
  cat <<SQL
\\set ON_ERROR_STOP on
BEGIN;
SET LOCAL app.user_id = '${TARGET_USER_ID}';

CREATE TEMP TABLE legacy_sessions (
    id BIGINT,
    start_time TIMESTAMPTZ,
    end_time TIMESTAMPTZ,
    kwh NUMERIC(10,2),
    cost_huf NUMERIC(12,2),
    odometer NUMERIC(10,2),
    notes TEXT,
    provider TEXT,
    city TEXT,
    ac_or_dc TEXT,
    kw TEXT,
    source TEXT,
    created_at TIMESTAMPTZ
) ON COMMIT DROP;

-- The header is stripped below, so psql must not skip a row of its own.
\\copy legacy_sessions FROM STDIN WITH (FORMAT csv)
SQL

  tail -n +2 "$WORKDIR/legacy.csv"

  cat <<SQL
\\.

-- The vehicle: matched on plate within the account, created if absent.
INSERT INTO vehicles (user_id, name, make, model, fuel_type, license_plate, battery_capacity_kwh)
SELECT ${TARGET_USER_ID}, '${VEHICLE_NAME}', '${VEHICLE_MAKE}', '${VEHICLE_MODEL}',
       'electric', '${PLATE}', ${BATTERY_KWH}
WHERE NOT EXISTS (
    SELECT 1 FROM vehicles
    WHERE user_id = ${TARGET_USER_ID} AND license_plate = '${PLATE}'
);

CREATE TEMP TABLE target_vehicle ON COMMIT DROP AS
SELECT id FROM vehicles
WHERE user_id = ${TARGET_USER_ID} AND license_plate = '${PLATE}'
ORDER BY id LIMIT 1;

-- Clear a previous run. vehicle_events has no cascade from charging_sessions,
-- so its read-model rows go first.
DELETE FROM vehicle_events
WHERE user_id = ${TARGET_USER_ID}
  AND legacy_source = 'charging_session'
  AND legacy_id IN (
      SELECT cs.id FROM charging_sessions cs, target_vehicle tv
      WHERE cs.user_id = ${TARGET_USER_ID}
        AND cs.vehicle_id = tv.id
        AND cs.source LIKE 'legacy\\_%'
  );

DELETE FROM charging_sessions cs
USING target_vehicle tv
WHERE cs.user_id = ${TARGET_USER_ID}
  AND cs.vehicle_id = tv.id
  AND cs.source LIKE 'legacy\\_%';

-- Sessions. provider/city/ac_or_dc/kw have no home in the new schema; the older
-- 98 rows already carry that text in notes, the newer ones get it composed.
INSERT INTO charging_sessions (
    user_id, vehicle_id, session_type, start_time, end_time,
    kwh, ${COST_COL}, source, odometer, notes, created_at
)
SELECT
    ${TARGET_USER_ID},
    tv.id,
    'charging',
    l.start_time,
    l.end_time,
    l.kwh,
    coalesce(l.cost_huf, 0),
    left('legacy_' || l.source, 80),
    round(l.odometer, 1),
    nullif(
        coalesce(
            nullif(btrim(l.notes), ''),
            btrim(concat_ws(' ', nullif(l.provider, ''), nullif(l.city, ''),
                                 nullif(l.ac_or_dc, ''),
                                 CASE WHEN nullif(l.kw, '') IS NOT NULL THEN l.kw || ' kW' END))
        ), ''),
    l.created_at
FROM legacy_sessions l, target_vehicle tv
ORDER BY l.start_time;

-- Read model. Mirrors backend/vehicle_events.py:backfill_vehicle_events.
INSERT INTO vehicle_events (
    user_id, vehicle_id, legacy_source, legacy_id, event_type, expense_category, title,
    occurred_at, ended_at, total_cost, currency, odometer_km, source, notes,
    energy_kwh, battery_level_start, battery_level_end, fuel_liters, created_at, updated_at
)
SELECT
    cs.user_id, cs.vehicle_id, 'charging_session', cs.id, cs.session_type, NULL, 'Charging',
    cs.start_time, cs.end_time, cs.${COST_COL}, 'HUF', cs.odometer, cs.source, cs.notes,
    cs.kwh, cs.battery_level_start, cs.battery_level_end, cs.fuel_liters, cs.created_at, NOW()
FROM charging_sessions cs, target_vehicle tv
WHERE cs.user_id = ${TARGET_USER_ID}
  AND cs.vehicle_id = tv.id
  AND cs.source LIKE 'legacy\\_%'
ON CONFLICT (legacy_source, legacy_id) DO NOTHING;

COMMIT;
SQL
} | target_psql -v ON_ERROR_STOP=1

# ---------------------------------------------------------------------------
# 4. Verify
# ---------------------------------------------------------------------------

echo
echo "--- imported ---"
target_psql -c "
  SET app.user_id = '${TARGET_USER_ID}';
  SELECT v.id AS vehicle_id, v.name, v.license_plate,
         count(cs.id) AS sessions,
         min(cs.start_time)::date AS first,
         max(cs.start_time)::date AS last,
         round(sum(cs.kwh), 1) AS total_kwh,
         round(sum(cs.${COST_COL})) AS total_cost
  FROM vehicles v
  LEFT JOIN charging_sessions cs
    ON cs.vehicle_id = v.id AND cs.source LIKE 'legacy\\_%'
  WHERE v.user_id = ${TARGET_USER_ID} AND v.license_plate = '${PLATE}'
  GROUP BY v.id, v.name, v.license_plate;

  SELECT count(*) AS vehicle_events
  FROM vehicle_events
  WHERE user_id = ${TARGET_USER_ID} AND source LIKE 'legacy\\_%';"
