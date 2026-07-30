from typing import Optional

try:
    from backend.db import column_exists, table_exists
except ModuleNotFoundError:
    from db import column_exists, table_exists


def get_activity_feed(
    db,
    user_id: str,
    limit: int = 50,
    activity_type: Optional[str] = None,
    vehicle_id: Optional[int] = None,
    search: Optional[str] = None,
    exclude_archived: bool = False,
):
    # No backfill here: every write path (sessions, expenses, CSV import) already
    # syncs into vehicle_events, and dev_seed.sql inserts them directly. Running it
    # per request cost a full scan of both legacy tables on every read.
    # Use scripts/reconcile-events.sh for a one-off reconciliation.
    cur = db.cursor()

    filters = []
    params = [user_id]

    if activity_type in {'session', 'expense'}:
        filters.append('combined_activity.activity_type = %s')
        params.append(activity_type)

    if vehicle_id is not None:
        filters.append('combined_activity.vehicle_id = %s')
        params.append(vehicle_id)

    if search:
        filters.append(
            "(combined_activity.title ILIKE %s OR combined_activity.vehicle_name ILIKE %s OR COALESCE(combined_activity.description, '') ILIKE %s)"
        )
        search_value = f'%{search}%'
        params.extend([search_value, search_value, search_value])

    # Off by default: Records is the user's own history and keeps showing an archived
    # vehicle's entries. The dashboard widget asks for the live fleet only. NOT EXISTS
    # rather than a join, so account-wide rows with a NULL vehicle_id survive.
    if exclude_archived and column_exists(db, 'vehicles', 'is_archived'):
        filters.append(
            'NOT EXISTS (SELECT 1 FROM vehicles archived_v'
            ' WHERE archived_v.id = combined_activity.vehicle_id'
            ' AND archived_v.is_archived = TRUE)'
        )

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ''
    params.append(limit)

    cur.execute(
        f"""
        SELECT *
        FROM (
            SELECT
                ve.id::text AS event_id,
                COALESCE(ve.legacy_id, ve.id)::text AS id,
                ve.legacy_source::text AS legacy_source,
                CASE WHEN ve.event_type IN ('charging', 'fueling') THEN 'session' ELSE 'expense' END::text AS activity_type,
                ve.occurred_at,
                ve.total_cost AS amount,
                COALESCE(ve.expense_category, ve.event_type)::text AS category,
                ve.vehicle_id::bigint AS vehicle_id,
                COALESCE(v.name, CONCAT(v.make, ' ', v.model), 'All vehicles')::text AS vehicle_name,
                COALESCE(ve.title, INITCAP(REPLACE(COALESCE(ve.expense_category, ve.event_type), '_', ' ')))::text AS title,
                ve.notes::text AS description
            FROM vehicle_events ve
            LEFT JOIN vehicles v ON v.id = ve.vehicle_id AND v.user_id = ve.user_id
            WHERE ve.user_id = %s
        ) combined_activity
        {where_clause}
        ORDER BY occurred_at DESC
        LIMIT %s;
        """,
        tuple(params),
    )

    return [
        {
            'id': row['id'],
            'event_id': row['event_id'],
            'legacy_source': row['legacy_source'],
            # Every event is backed by a charging_sessions or expenses row, so edits and
            # deletes go through those endpoints. Kept as explicit flags so the UI does
            # not have to know the mapping.
            'can_edit': row['legacy_source'] in {'charging_session', 'expense'},
            'can_delete': row['legacy_source'] in {'charging_session', 'expense'},
            'activity_type': row['activity_type'],
            'occurred_at': row['occurred_at'].isoformat() if row.get('occurred_at') else None,
            'amount': float(row['amount'] or 0),
            'category': row['category'],
            'vehicle_id': row.get('vehicle_id'),
            'vehicle_name': row['vehicle_name'],
            'title': row['title'],
            'description': row.get('description'),
        }
        for row in cur.fetchall()
    ]


def get_activity_export_rows(
    db,
    user_id: str,
    activity_type: Optional[str] = None,
    vehicle_id: Optional[int] = None,
    search: Optional[str] = None,
):
    cur = db.cursor()

    filters = []
    params = [user_id]

    if activity_type in {'session', 'expense'}:
        filters.append('combined_activity.activity_type = %s')
        params.append(activity_type)

    if vehicle_id is not None:
        filters.append('combined_activity.vehicle_id = %s')
        params.append(vehicle_id)

    if search:
        filters.append(
            "(combined_activity.title ILIKE %s OR combined_activity.vehicle_name ILIKE %s OR COALESCE(combined_activity.description, '') ILIKE %s)"
        )
        search_value = f'%{search}%'
        params.extend([search_value, search_value, search_value])

    where_clause = f"WHERE {' AND '.join(filters)}" if filters else ''

    cur.execute(
        f"""
        SELECT *
        FROM (
            SELECT
                ve.id::text AS event_id,
                COALESCE(ve.legacy_id, ve.id)::text AS id,
                -- id is cast to text for the API, so keep a numeric copy to sort on;
                -- ordering by the text column puts row 9 after row 10.
                ve.id AS event_id_sort,
                ve.legacy_source::text AS legacy_source,
                CASE WHEN ve.event_type IN ('charging', 'fueling') THEN 'session' ELSE 'expense' END::text AS activity_type,
                ve.event_type::text AS event_type,
                COALESCE(ve.expense_category, ve.event_type)::text AS category,
                ve.occurred_at,
                ve.ended_at,
                ve.total_cost AS amount,
                ve.currency::text AS currency,
                ve.vehicle_id::bigint AS vehicle_id,
                COALESCE(v.name, CONCAT(v.make, ' ', v.model), 'All vehicles')::text AS vehicle_name,
                COALESCE(ve.title, INITCAP(REPLACE(COALESCE(ve.expense_category, ve.event_type), '_', ' ')))::text AS title,
                ve.notes::text AS description,
                ve.energy_kwh,
                ve.fuel_liters,
                ve.odometer_km,
                ve.source::text AS source,
                ve.battery_level_start,
                ve.battery_level_end
            FROM vehicle_events ve
            LEFT JOIN vehicles v ON v.id = ve.vehicle_id AND v.user_id = ve.user_id
            WHERE ve.user_id = %s
        ) combined_activity
        {where_clause}
        ORDER BY occurred_at DESC, event_id_sort DESC;
        """,
        tuple(params),
    )

    return cur.fetchall()