from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

try:
    from backend.activity import get_activity_feed
    from backend.auth_utils import get_current_user_id
    from backend.db import get_db
    from backend.routers.expenses import ensure_recurring_expense_table
    from backend.routers.vehicles import has_archive_support
    from backend.vehicle_events import backfill_vehicle_events, ensure_vehicle_events_table
except ModuleNotFoundError:
    from activity import get_activity_feed
    from auth_utils import get_current_user_id
    from db import get_db
    from routers.expenses import ensure_recurring_expense_table
    from routers.vehicles import has_archive_support
    from vehicle_events import backfill_vehicle_events, ensure_vehicle_events_table

router = APIRouter(tags=['insights'])


def _float(value) -> float:
    return float(value or 0)


def _int(value) -> int:
    return int(value or 0)


def _get_previous_month(value: date) -> date:
    if value.month == 1:
        return date(value.year - 1, 12, 1)
    return date(value.year, value.month - 1, 1)


def _serialize_monthly_row(row: dict) -> dict:
    total_cost = _float(row.get('total_cost'))
    total_distance_km = _float(row.get('total_distance_km'))

    return {
        'month': row['month'],
        'total_energy_kwh': _float(row.get('total_energy_kwh')),
        'session_cost_huf': _float(row.get('session_cost')),
        'session_count': _int(row.get('session_count')),
        'expense_cost_huf': _float(row.get('expense_cost')),
        'expense_count': _int(row.get('expense_count')),
        'total_distance_km': total_distance_km,
        'total_cost_huf': total_cost,
        'avg_cost_per_100km': (total_cost / total_distance_km * 100) if total_distance_km > 0 else 0,
    }


def _fetch_monthly_stats(cur, user_id: str) -> list[dict]:
    cur.execute(
        """
        WITH monthly_event_stats AS (
            SELECT
                DATE_TRUNC('month', occurred_at) AS month_start,
                COALESCE(SUM(CASE WHEN event_type = 'charging' THEN energy_kwh ELSE 0 END), 0) AS total_energy_kwh,
                COALESCE(SUM(CASE WHEN event_type IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS session_cost,
                COUNT(*) FILTER (WHERE event_type IN ('charging', 'fueling')) AS session_count,
                COALESCE(SUM(CASE WHEN event_type NOT IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS expense_cost,
                COUNT(*) FILTER (WHERE event_type NOT IN ('charging', 'fueling')) AS expense_count
            FROM vehicle_events
            WHERE user_id = %s
            GROUP BY DATE_TRUNC('month', occurred_at)
        ),
        monthly_distance AS (
            SELECT
                month_start,
                COALESCE(SUM(distance_km), 0) AS total_distance_km
            FROM (
                SELECT
                    vehicle_id,
                    DATE_TRUNC('month', occurred_at) AS month_start,
                    GREATEST(MAX(odometer_km) - MIN(odometer_km), 0) AS distance_km
                FROM vehicle_events
                WHERE user_id = %s AND odometer_km IS NOT NULL
                GROUP BY vehicle_id, DATE_TRUNC('month', occurred_at)
            ) per_vehicle_month
            GROUP BY month_start
        )
        SELECT
            TO_CHAR(monthly_event_stats.month_start, 'YYYY-MM') AS month,
            monthly_event_stats.total_energy_kwh,
            monthly_event_stats.session_cost,
            monthly_event_stats.session_count,
            monthly_event_stats.expense_cost,
            monthly_event_stats.expense_count,
            COALESCE(monthly_distance.total_distance_km, 0) AS total_distance_km,
            monthly_event_stats.session_cost + monthly_event_stats.expense_cost AS total_cost
        FROM monthly_event_stats
        LEFT JOIN monthly_distance ON monthly_distance.month_start = monthly_event_stats.month_start
        ORDER BY monthly_event_stats.month_start;
        """,
        (user_id, user_id),
    )
    return [_serialize_monthly_row(row) for row in cur.fetchall()]


def _empty_period(month: str) -> dict:
    return {
        'month': month,
        'total_energy_kwh': 0,
        'session_cost_huf': 0,
        'session_count': 0,
        'expense_cost_huf': 0,
        'expense_count': 0,
        'total_distance_km': 0,
        'total_cost_huf': 0,
        'avg_cost_per_100km': 0,
    }


@router.get('/dashboard/stats')
def get_dashboard_stats(user_id: str = Depends(get_current_user_id), db=Depends(get_db)):
    ensure_vehicle_events_table(db)
    backfill_vehicle_events(db)
    ensure_recurring_expense_table(db)
    cur = db.cursor()
    cur.execute(
        """
        WITH event_totals AS (
            SELECT
                COALESCE(SUM(CASE WHEN event_type = 'charging' THEN energy_kwh ELSE 0 END), 0) AS total_energy_kwh,
                COALESCE(SUM(CASE WHEN event_type IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS total_session_cost_huf,
                COUNT(*) FILTER (WHERE event_type IN ('charging', 'fueling')) AS total_sessions,
                COALESCE(SUM(CASE WHEN event_type NOT IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS total_expense_cost,
                COUNT(*) FILTER (WHERE event_type NOT IN ('charging', 'fueling')) AS total_expenses
            FROM vehicle_events
            WHERE user_id = %s
        ),
        vehicle_distance_stats AS (
            SELECT
                v.id,
                GREATEST(
                    COALESCE(MAX(ve.odometer_km), v.starting_odometer_km) - COALESCE(v.starting_odometer_km, MIN(ve.odometer_km)),
                    0
                ) AS distance_km,
                COALESCE(SUM(ve.total_cost), 0) AS total_cost
            FROM vehicles v
            LEFT JOIN vehicle_events ve ON ve.vehicle_id = v.id AND ve.user_id = v.user_id
            WHERE v.user_id = %s
            GROUP BY v.id, v.starting_odometer_km
        ),
        distance_totals AS (
            SELECT
                COALESCE(SUM(distance_km), 0) AS total_distance_km,
                COALESCE(SUM(total_cost), 0) AS total_distance_cost_huf,
                COUNT(*) FILTER (WHERE distance_km > 0) AS vehicles_with_distance
            FROM vehicle_distance_stats
        )
        SELECT
            event_totals.total_energy_kwh,
            event_totals.total_session_cost_huf,
            event_totals.total_sessions,
            event_totals.total_expense_cost,
            event_totals.total_expenses,
            distance_totals.total_distance_km,
            distance_totals.total_distance_cost_huf,
            distance_totals.vehicles_with_distance
        FROM event_totals
        CROSS JOIN distance_totals;
        """,
        (user_id, user_id),
    )
    totals = cur.fetchone() or {}

    monthly_stats = _fetch_monthly_stats(cur, user_id)
    monthly_stats_by_key = {row['month']: row for row in monthly_stats}
    current_month_start = date.today().replace(day=1)
    previous_month_start = _get_previous_month(current_month_start)
    current_month_key = current_month_start.strftime('YYYY-MM')
    previous_month_key = previous_month_start.strftime('YYYY-MM')
    current_month = monthly_stats_by_key.get(current_month_start.strftime('%Y-%m'), _empty_period(current_month_start.strftime('%Y-%m')))
    previous_month = monthly_stats_by_key.get(previous_month_start.strftime('%Y-%m'), _empty_period(previous_month_start.strftime('%Y-%m')))

    cur.execute(
        """
        WITH event_stats AS (
            SELECT
                vehicle_id,
                COALESCE(SUM(CASE WHEN event_type = 'charging' THEN energy_kwh ELSE 0 END), 0) AS total_energy,
                COALESCE(SUM(CASE WHEN event_type IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS session_cost,
                COALESCE(SUM(CASE WHEN event_type NOT IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS expense_cost
            FROM vehicle_events
            WHERE user_id = %s AND vehicle_id IS NOT NULL
            GROUP BY vehicle_id
        ),
        odometer_stats AS (
            SELECT
                v.id AS vehicle_id,
                GREATEST(
                    COALESCE(MAX(ve.odometer_km), v.starting_odometer_km) - COALESCE(v.starting_odometer_km, MIN(ve.odometer_km)),
                    0
                ) AS distance_km
            FROM vehicles v
            LEFT JOIN vehicle_events ve ON ve.vehicle_id = v.id AND ve.user_id = v.user_id
            WHERE v.user_id = %s
            GROUP BY v.id, v.starting_odometer_km
        )
        SELECT
            v.id,
            COALESCE(v.name, CONCAT(v.make, ' ', v.model)) AS name,
            v.fuel_type,
            COALESCE(event_stats.total_energy, 0) AS total_energy,
            COALESCE(event_stats.session_cost, 0) + COALESCE(event_stats.expense_cost, 0) AS total_cost,
            COALESCE(event_stats.session_cost, 0) AS session_cost,
            COALESCE(event_stats.expense_cost, 0) AS expense_cost,
            COALESCE(odometer_stats.distance_km, 0) AS distance_km,
            CASE
                WHEN COALESCE(odometer_stats.distance_km, 0) > 0 THEN ((COALESCE(event_stats.session_cost, 0) + COALESCE(event_stats.expense_cost, 0)) / odometer_stats.distance_km) * 100
                ELSE NULL
            END AS cost_per_100km
        FROM vehicles v
        LEFT JOIN event_stats ON event_stats.vehicle_id = v.id
        LEFT JOIN odometer_stats ON odometer_stats.vehicle_id = v.id
        WHERE v.user_id = %s
        GROUP BY v.id, v.name, v.make, v.model, v.fuel_type, event_stats.total_energy, event_stats.session_cost, event_stats.expense_cost, odometer_stats.distance_km
        ORDER BY total_cost DESC, name ASC;
        """,
        (user_id, user_id, user_id),
    )
    vehicle_rows = cur.fetchall()
    vehicle_stats = [
        {
            'id': row['id'],
            'name': row['name'],
            'fuel_type': row['fuel_type'],
            'total_energy': _float(row.get('total_energy')),
            'total_cost': _float(row.get('total_cost')),
            'session_cost': _float(row.get('session_cost')),
            'expense_cost': _float(row.get('expense_cost')),
            'distance_km': _float(row.get('distance_km')),
            'cost_per_100km': float(row['cost_per_100km']) if row.get('cost_per_100km') is not None else None,
        }
        for row in vehicle_rows
    ]

    recent_activity = get_activity_feed(db, user_id, limit=6)

    cur.execute(
        """
        SELECT
            COALESCE(expense_category, 'other') AS category,
            COALESCE(SUM(total_cost), 0) AS total_amount
        FROM vehicle_events
        WHERE user_id = %s
          AND event_type NOT IN ('charging', 'fueling')
          AND occurred_at >= DATE_TRUNC('month', CURRENT_DATE)
          AND occurred_at < DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month'
        GROUP BY COALESCE(expense_category, 'other')
        ORDER BY total_amount DESC, category ASC
        LIMIT 1;
        """,
        (user_id,),
    )
    top_expense_category = cur.fetchone()

    cur.execute(
        """
        SELECT
            r.id,
            COALESCE(v.name, CONCAT(v.make, ' ', v.model)) AS vehicle_name,
            r.category,
            r.amount,
            r.frequency,
            r.next_due_date,
            r.description
        FROM recurring_expense_reminders r
        LEFT JOIN vehicles v ON v.id = r.vehicle_id AND v.user_id = r.user_id
        WHERE r.user_id = %s
          AND r.is_active = TRUE
          AND r.next_due_date <= CURRENT_DATE + INTERVAL '30 days'
        ORDER BY r.next_due_date ASC, r.created_at ASC
        LIMIT 4;
        """,
        (user_id,),
    )
    upcoming_reminders = cur.fetchall()

    cur.execute(
        """
        SELECT COUNT(*) AS overdue_count
        FROM recurring_expense_reminders
        WHERE user_id = %s AND is_active = TRUE AND next_due_date < CURRENT_DATE;
        """,
        (user_id,),
    )
    overdue_reminders = _int((cur.fetchone() or {}).get('overdue_count'))

    active_vehicle_filter = 'AND v.is_archived = FALSE' if has_archive_support(db) else ''
    cur.execute(
        f"""
        SELECT COUNT(*) AS inactive_vehicle_count
        FROM vehicles v
        WHERE v.user_id = %s
          {active_vehicle_filter}
          AND NOT EXISTS (
              SELECT 1
              FROM vehicle_events ve
              WHERE ve.user_id = v.user_id
                AND ve.vehicle_id = v.id
                AND ve.occurred_at >= NOW() - INTERVAL '45 days'
          );
        """,
        (user_id,),
    )
    inactive_vehicle_count = _int((cur.fetchone() or {}).get('inactive_vehicle_count'))

    total_session_cost_huf = _float(totals.get('total_session_cost_huf'))
    total_expense_cost = _float(totals.get('total_expense_cost'))
    total_sessions = _int(totals.get('total_sessions'))
    total_expenses = _int(totals.get('total_expenses'))
    total_distance_km = _float(totals.get('total_distance_km'))
    total_distance_cost_huf = _float(totals.get('total_distance_cost_huf'))
    avg_cost_per_100km = (total_distance_cost_huf / total_distance_km * 100) if total_distance_km > 0 else 0
    top_cost_vehicles = sorted(vehicle_stats, key=lambda vehicle: (float(vehicle.get('total_cost') or 0), vehicle.get('name') or ''), reverse=True)[:3]

    alerts = []
    if overdue_reminders:
        alerts.append({
            'level': 'warning',
            'title': 'Recurring reminders overdue',
            'description': f'{overdue_reminders} recurring expense reminder needs attention.',
        })
    if inactive_vehicle_count:
        alerts.append({
            'level': 'info',
            'title': 'Inactive vehicles',
            'description': f'{inactive_vehicle_count} vehicle has no tracked activity in the last 45 days.',
        })
    if previous_month['total_cost_huf'] > 0 and current_month['total_cost_huf'] > previous_month['total_cost_huf']:
        alerts.append({
            'level': 'warning',
            'title': 'Monthly cost increased',
            'description': 'Current month operating cost is higher than the previous month.',
        })
    if not alerts:
        alerts.append({
            'level': 'success',
            'title': 'Overview looks healthy',
            'description': 'No overdue reminders or unusual inactivity detected right now.',
        })

    return {
        'total_energy_kwh': _float(totals.get('total_energy_kwh')),
        'total_cost_huf': total_session_cost_huf + total_expense_cost,
        'total_session_cost_huf': total_session_cost_huf,
        'total_expense_cost_huf': total_expense_cost,
        'total_distance_km': total_distance_km,
        'avg_cost_per_100km': avg_cost_per_100km,
        'vehicles_with_distance': _int(totals.get('vehicles_with_distance')),
        'total_sessions': total_sessions,
        'total_expenses': total_expenses,
        'total_records': total_sessions + total_expenses,
        'monthly_stats': monthly_stats,
        'current_month': current_month,
        'previous_month': previous_month,
        'cost_composition': {
            'session_cost_huf': current_month['session_cost_huf'],
            'expense_cost_huf': current_month['expense_cost_huf'],
            'energy_kwh': current_month['total_energy_kwh'],
            'top_expense_category': {
                'category': top_expense_category['category'],
                'total_amount': _float(top_expense_category['total_amount']),
            } if top_expense_category else None,
        },
        'fleet_snapshot': {
            'total_vehicles': len(vehicle_stats),
            'electric_count': sum(1 for vehicle in vehicle_stats if vehicle.get('fuel_type') == 'electric'),
            'hybrid_count': sum(1 for vehicle in vehicle_stats if vehicle.get('fuel_type') == 'hybrid'),
            'combustion_count': sum(1 for vehicle in vehicle_stats if vehicle.get('fuel_type') in ('petrol', 'diesel')),
            'top_cost_vehicles': [
                {
                    'id': vehicle['id'],
                    'name': vehicle['name'],
                    'fuel_type': vehicle['fuel_type'],
                    'total_cost': _float(vehicle.get('total_cost')),
                    'distance_km': _float(vehicle.get('distance_km')),
                }
                for vehicle in top_cost_vehicles
            ],
        },
        'alerts': alerts,
        'upcoming_reminders': [
            {
                'id': reminder['id'],
                'vehicle_name': reminder['vehicle_name'],
                'category': reminder['category'],
                'amount': _float(reminder.get('amount')),
                'frequency': reminder['frequency'],
                'next_due_date': reminder['next_due_date'].isoformat() if reminder.get('next_due_date') else None,
                'description': reminder.get('description'),
            }
            for reminder in upcoming_reminders
        ],
        'recent_activity': recent_activity,
        'vehicle_stats': [
            {
                'id': row['id'],
                'name': row['name'],
                'fuel_type': row['fuel_type'],
                'total_energy': _float(row.get('total_energy')),
                'total_cost': _float(row.get('total_cost')),
                'distance_km': _float(row.get('distance_km')),
                'cost_per_100km': float(row['cost_per_100km']) if row.get('cost_per_100km') is not None else None,
            }
            for row in vehicle_stats
        ],
    }



def _get_analytics_range_bounds(range_key: str) -> tuple[str, date | None, date]:
    normalized = (range_key or 'all').strip().lower()
    today = date.today()
    end_date = today + timedelta(days=1)

    if normalized == 'all':
        return normalized, None, end_date
    if normalized == '30d':
        return normalized, today - timedelta(days=29), end_date
    if normalized == '90d':
        return normalized, today - timedelta(days=89), end_date
    if normalized == 'ytd':
        return normalized, date(today.year, 1, 1), end_date

    raise HTTPException(status_code=400, detail='Range must be one of: 30d, 90d, ytd, all')


def _fetch_monthly_stats(cur, user_id: str, start_date: date | None = None, end_date: date | None = None, vehicle_id: int | None = None) -> list[dict]:
    event_filters = ['user_id = %s']
    event_params: list[object] = [user_id]
    distance_filters = ['user_id = %s', 'odometer_km IS NOT NULL']
    distance_params: list[object] = [user_id]

    if start_date is not None:
        event_filters.append('occurred_at >= %s')
        distance_filters.append('occurred_at >= %s')
        event_params.append(start_date.isoformat())
        distance_params.append(start_date.isoformat())

    if end_date is not None:
        event_filters.append('occurred_at < %s')
        distance_filters.append('occurred_at < %s')
        event_params.append(end_date.isoformat())
        distance_params.append(end_date.isoformat())

    if vehicle_id is not None:
        event_filters.append('vehicle_id = %s')
        distance_filters.append('vehicle_id = %s')
        event_params.append(vehicle_id)
        distance_params.append(vehicle_id)

    cur.execute(
        f"""
        WITH monthly_event_stats AS (
            SELECT
                DATE_TRUNC('month', occurred_at) AS month_start,
                COALESCE(SUM(CASE WHEN event_type = 'charging' THEN energy_kwh ELSE 0 END), 0) AS total_energy_kwh,
                COALESCE(SUM(CASE WHEN event_type IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS session_cost,
                COUNT(*) FILTER (WHERE event_type IN ('charging', 'fueling')) AS session_count,
                COALESCE(SUM(CASE WHEN event_type NOT IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS expense_cost,
                COUNT(*) FILTER (WHERE event_type NOT IN ('charging', 'fueling')) AS expense_count
            FROM vehicle_events
            WHERE {' AND '.join(event_filters)}
            GROUP BY DATE_TRUNC('month', occurred_at)
        ),
        monthly_distance AS (
            SELECT
                month_start,
                COALESCE(SUM(distance_km), 0) AS total_distance_km
            FROM (
                SELECT
                    vehicle_id,
                    DATE_TRUNC('month', occurred_at) AS month_start,
                    GREATEST(MAX(odometer_km) - MIN(odometer_km), 0) AS distance_km
                FROM vehicle_events
                WHERE {' AND '.join(distance_filters)}
                GROUP BY vehicle_id, DATE_TRUNC('month', occurred_at)
            ) per_vehicle_month
            GROUP BY month_start
        )
        SELECT
            TO_CHAR(monthly_event_stats.month_start, 'YYYY-MM') AS month,
            monthly_event_stats.total_energy_kwh,
            monthly_event_stats.session_cost,
            monthly_event_stats.session_count,
            monthly_event_stats.expense_cost,
            monthly_event_stats.expense_count,
            COALESCE(monthly_distance.total_distance_km, 0) AS total_distance_km,
            monthly_event_stats.session_cost + monthly_event_stats.expense_cost AS total_cost
        FROM monthly_event_stats
        LEFT JOIN monthly_distance ON monthly_distance.month_start = monthly_event_stats.month_start
        ORDER BY monthly_event_stats.month_start;
        """,
        event_params + distance_params,
    )
    return [_serialize_monthly_row(row) for row in cur.fetchall()]


@router.get('/analytics/summary')
def get_analytics_summary(
    range_key: str = Query('all', alias='range'),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_db),
):
    ensure_vehicle_events_table(db)
    backfill_vehicle_events(db)
    cur = db.cursor()
    normalized_range, start_date, end_date = _get_analytics_range_bounds(range_key)

    weekly_filters = ['user_id = %s', "event_type = 'charging'"]
    weekly_params: list[object] = [user_id]
    event_filters = ['user_id = %s', 'vehicle_id IS NOT NULL']
    event_params: list[object] = [user_id]
    join_filters = []
    join_params: list[object] = []
    expense_filters = ['user_id = %s', "event_type NOT IN ('charging', 'fueling')"]
    expense_params: list[object] = [user_id]
    avg_filters = ['user_id = %s', "event_type = 'charging'", 'energy_kwh IS NOT NULL', 'energy_kwh > 0']
    avg_params: list[object] = [user_id]

    if start_date is not None:
        start_value = start_date.isoformat()
        weekly_filters.append('occurred_at >= %s')
        event_filters.append('occurred_at >= %s')
        join_filters.append('ve.occurred_at >= %s')
        expense_filters.append('occurred_at >= %s')
        avg_filters.append('occurred_at >= %s')
        weekly_params.append(start_value)
        event_params.append(start_value)
        join_params.append(start_value)
        expense_params.append(start_value)
        avg_params.append(start_value)

    if end_date is not None:
        end_value = end_date.isoformat()
        weekly_filters.append('occurred_at < %s')
        event_filters.append('occurred_at < %s')
        join_filters.append('ve.occurred_at < %s')
        expense_filters.append('occurred_at < %s')
        avg_filters.append('occurred_at < %s')
        weekly_params.append(end_value)
        event_params.append(end_value)
        join_params.append(end_value)
        expense_params.append(end_value)
        avg_params.append(end_value)

    cur.execute(
        f"""
        SELECT
            TO_CHAR(DATE_TRUNC('week', occurred_at), 'YYYY-MM-DD') AS week,
            COALESCE(SUM(energy_kwh), 0) AS energy
        FROM vehicle_events
        WHERE {' AND '.join(weekly_filters)}
        GROUP BY DATE_TRUNC('week', occurred_at)
        ORDER BY DATE_TRUNC('week', occurred_at) DESC
        LIMIT 8;
        """,
        weekly_params,
    )
    weekly_trend = list(reversed(cur.fetchall()))

    cur.execute(
        f"""
        WITH event_stats AS (
            SELECT
                vehicle_id,
                COALESCE(SUM(CASE WHEN event_type = 'charging' THEN energy_kwh ELSE 0 END), 0) AS total_energy,
                COALESCE(SUM(CASE WHEN event_type IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS session_cost,
                COALESCE(SUM(CASE WHEN event_type NOT IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS expense_cost
            FROM vehicle_events
            WHERE {' AND '.join(event_filters)}
            GROUP BY vehicle_id
        ),
        odometer_stats AS (
            SELECT
                v.id AS vehicle_id,
                GREATEST(
                    COALESCE(MAX(ve.odometer_km), v.starting_odometer_km) - COALESCE(v.starting_odometer_km, MIN(ve.odometer_km)),
                    0
                ) AS distance_km
            FROM vehicles v
            LEFT JOIN vehicle_events ve ON ve.vehicle_id = v.id AND ve.user_id = v.user_id{' AND ' + ' AND '.join(join_filters) if join_filters else ''}
            WHERE v.user_id = %s
            GROUP BY v.id, v.starting_odometer_km
        )
        SELECT
            v.id,
            COALESCE(v.name, CONCAT(v.make, ' ', v.model)) AS name,
            v.fuel_type,
            COALESCE(event_stats.total_energy, 0) AS total_energy,
            COALESCE(event_stats.session_cost, 0) + COALESCE(event_stats.expense_cost, 0) AS total_cost,
            COALESCE(event_stats.session_cost, 0) AS session_cost,
            COALESCE(event_stats.expense_cost, 0) AS expense_cost,
            COALESCE(odometer_stats.distance_km, 0) AS distance_km,
            CASE
                WHEN COALESCE(odometer_stats.distance_km, 0) > 0 THEN ((COALESCE(event_stats.session_cost, 0) + COALESCE(event_stats.expense_cost, 0)) / odometer_stats.distance_km) * 100
                ELSE NULL
            END AS cost_per_100km
        FROM vehicles v
        LEFT JOIN event_stats ON event_stats.vehicle_id = v.id
        LEFT JOIN odometer_stats ON odometer_stats.vehicle_id = v.id
        WHERE v.user_id = %s
        GROUP BY v.id, v.name, v.make, v.model, v.fuel_type, event_stats.total_energy, event_stats.session_cost, event_stats.expense_cost, odometer_stats.distance_km
        ORDER BY total_cost DESC, name ASC;
        """,
        event_params + join_params + [user_id, user_id],
    )
    vehicle_stats = cur.fetchall()
    monthly_trend = _fetch_monthly_stats(cur, user_id, start_date=start_date, end_date=end_date)

    cur.execute(
        f"""
        SELECT
            COALESCE(expense_category, 'other') AS category,
            COALESCE(SUM(total_cost), 0) AS total_amount,
            COUNT(*) AS item_count
        FROM vehicle_events
        WHERE {' AND '.join(expense_filters)}
        GROUP BY COALESCE(expense_category, 'other')
        ORDER BY total_amount DESC, category ASC;
        """,
        expense_params,
    )
    expense_categories = cur.fetchall()

    cur.execute(
        f"""
        SELECT COALESCE(SUM(total_cost) / NULLIF(SUM(energy_kwh), 0), 0) AS avg_cost_per_kwh
        FROM vehicle_events
        WHERE {' AND '.join(avg_filters)};
        """,
        avg_params,
    )
    avg_row = cur.fetchone() or {}

    serialized_vehicle_stats = [
        {
            'id': row['id'],
            'name': row['name'],
            'fuel_type': row['fuel_type'],
            'total_energy': _float(row.get('total_energy')),
            'total_cost': _float(row.get('total_cost')),
            'session_cost': _float(row.get('session_cost')),
            'expense_cost': _float(row.get('expense_cost')),
            'distance_km': _float(row.get('distance_km')),
            'cost_per_100km': float(row['cost_per_100km']) if row.get('cost_per_100km') is not None else None,
        }
        for row in vehicle_stats
    ]
    total_operating_cost_huf = sum(row['total_cost'] for row in serialized_vehicle_stats)
    total_distance_km = sum(row['distance_km'] for row in serialized_vehicle_stats)
    total_energy_kwh = sum(row['total_energy'] for row in serialized_vehicle_stats)
    session_cost_huf = sum(row['session_cost'] for row in serialized_vehicle_stats)
    expense_cost_huf = sum(row['expense_cost'] for row in serialized_vehicle_stats)
    avg_cost_per_100km = (total_operating_cost_huf / total_distance_km * 100) if total_distance_km > 0 else 0

    return {
        'range': normalized_range,
        'weekly_trend': [{'week': row['week'], 'energy': float(row['energy'] or 0)} for row in weekly_trend],
        'monthly_trend': monthly_trend,
        'vehicle_stats': serialized_vehicle_stats,
        'expense_categories': [
            {
                'category': row['category'],
                'total_amount': float(row['total_amount'] or 0),
                'item_count': int(row['item_count'] or 0),
            }
            for row in expense_categories
        ],
        'summary': {
            'total_operating_cost_huf': total_operating_cost_huf,
            'total_distance_km': total_distance_km,
            'total_energy_kwh': total_energy_kwh,
            'session_cost_huf': session_cost_huf,
            'expense_cost_huf': expense_cost_huf,
            'avg_cost_per_100km': avg_cost_per_100km,
            'expense_share_pct': (expense_cost_huf / total_operating_cost_huf * 100) if total_operating_cost_huf > 0 else 0,
            'session_share_pct': (session_cost_huf / total_operating_cost_huf * 100) if total_operating_cost_huf > 0 else 0,
            'top_expense_category': {
                'category': expense_categories[0]['category'],
                'total_amount': _float(expense_categories[0].get('total_amount')),
                'item_count': _int(expense_categories[0].get('item_count')),
            } if expense_categories else None,
        },
        'total_expense_cost_huf': expense_cost_huf,
        'avg_cost_per_kwh': float(avg_row.get('avg_cost_per_kwh', 0) or 0),
    }


@router.get('/analytics/vehicles/{vehicle_id}')
def get_vehicle_analytics_drilldown(
    vehicle_id: int,
    range_key: str = Query('all', alias='range'),
    user_id: str = Depends(get_current_user_id),
    db=Depends(get_db),
):
    ensure_vehicle_events_table(db)
    backfill_vehicle_events(db)
    cur = db.cursor()
    normalized_range, start_date, end_date = _get_analytics_range_bounds(range_key)

    cur.execute(
        """
        SELECT
            id,
            COALESCE(name, CONCAT(make, ' ', model)) AS name,
            fuel_type,
            make,
            model
        FROM vehicles
        WHERE id = %s AND user_id = %s;
        """,
        (vehicle_id, user_id),
    )
    vehicle = cur.fetchone()
    if not vehicle:
        raise HTTPException(status_code=404, detail='Vehicle not found')

    event_filters = ['user_id = %s', 'vehicle_id = %s']
    event_params: list[object] = [user_id, vehicle_id]
    category_filters = ['user_id = %s', 'vehicle_id = %s', "event_type NOT IN ('charging', 'fueling')"]
    category_params: list[object] = [user_id, vehicle_id]

    if start_date is not None:
        start_value = start_date.isoformat()
        event_filters.append('occurred_at >= %s')
        category_filters.append('occurred_at >= %s')
        event_params.append(start_value)
        category_params.append(start_value)

    if end_date is not None:
        end_value = end_date.isoformat()
        event_filters.append('occurred_at < %s')
        category_filters.append('occurred_at < %s')
        event_params.append(end_value)
        category_params.append(end_value)

    cur.execute(
        f"""
        WITH filtered_events AS (
            SELECT *
            FROM vehicle_events
            WHERE {' AND '.join(event_filters)}
        )
        SELECT
            COALESCE(SUM(CASE WHEN event_type = 'charging' THEN energy_kwh ELSE 0 END), 0) AS total_energy_kwh,
            COALESCE(SUM(CASE WHEN event_type IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS session_cost_huf,
            COALESCE(SUM(CASE WHEN event_type NOT IN ('charging', 'fueling') THEN total_cost ELSE 0 END), 0) AS expense_cost_huf,
            COALESCE(SUM(total_cost), 0) AS total_cost_huf,
            COUNT(*) AS total_records,
            GREATEST(COALESCE(MAX(odometer_km), 0) - COALESCE(MIN(odometer_km), 0), 0) AS distance_km
        FROM filtered_events;
        """,
        event_params,
    )
    summary = cur.fetchone() or {}

    cur.execute(
        f"""
        SELECT
            event_type,
            COALESCE(expense_category, event_type) AS category,
            occurred_at,
            total_cost,
            energy_kwh,
            odometer_km,
            notes AS description
        FROM vehicle_events
        WHERE {' AND '.join(event_filters)}
        ORDER BY occurred_at DESC
        LIMIT 6;
        """,
        event_params,
    )
    recent_events = cur.fetchall()

    cur.execute(
        f"""
        SELECT
            COALESCE(expense_category, 'other') AS category,
            COALESCE(SUM(total_cost), 0) AS total_amount,
            COUNT(*) AS item_count
        FROM vehicle_events
        WHERE {' AND '.join(category_filters)}
        GROUP BY COALESCE(expense_category, 'other')
        ORDER BY total_amount DESC, category ASC;
        """,
        category_params,
    )
    expense_categories = cur.fetchall()

    monthly_trend = _fetch_monthly_stats(cur, user_id, start_date=start_date, end_date=end_date, vehicle_id=vehicle_id)
    distance_km = _float(summary.get('distance_km'))
    total_cost_huf = _float(summary.get('total_cost_huf'))

    return {
        'range': normalized_range,
        'vehicle': {
            'id': vehicle['id'],
            'name': vehicle['name'],
            'fuel_type': vehicle['fuel_type'],
            'make': vehicle.get('make'),
            'model': vehicle.get('model'),
        },
        'summary': {
            'total_energy_kwh': _float(summary.get('total_energy_kwh')),
            'session_cost_huf': _float(summary.get('session_cost_huf')),
            'expense_cost_huf': _float(summary.get('expense_cost_huf')),
            'total_cost_huf': total_cost_huf,
            'distance_km': distance_km,
            'total_records': _int(summary.get('total_records')),
            'avg_cost_per_100km': (total_cost_huf / distance_km * 100) if distance_km > 0 else 0,
        },
        'monthly_trend': monthly_trend,
        'expense_categories': [
            {
                'category': row['category'],
                'total_amount': _float(row.get('total_amount')),
                'item_count': _int(row.get('item_count')),
            }
            for row in expense_categories
        ],
        'recent_events': [
            {
                'event_type': row['event_type'],
                'category': row['category'],
                'occurred_at': row['occurred_at'].isoformat() if row.get('occurred_at') else None,
                'total_cost': _float(row.get('total_cost')),
                'energy_kwh': _float(row.get('energy_kwh')),
                'odometer_km': _float(row.get('odometer_km')),
                'description': row.get('description'),
            }
            for row in recent_events
        ],
    }