"""Projected running cost for the rest of the calendar year.

The hard part is not the arithmetic, it is not fooling yourself. Three things make a
naive "average the last few months and repeat it" projection wrong:

1. Consumption is seasonal, and far more so for an electric car. A combustion engine
   heats the cabin with waste heat it produces anyway; a battery car spends stored
   energy on it, and additionally warms the pack itself. Winter tyres, denser cold air
   and shorter trips add to both. Published fleet data puts a battery car's winter
   penalty around a quarter to a third, and a combustion car's nearer a tenth.

2. If the history you average over is winter-heavy, its average is already inflated.
   Multiplying that by a winter factor counts the same effect twice. So the baseline is
   *de-seasonalised* first — every observation is divided by the factor for the month it
   happened in — and the seasonal factor is only re-applied to the months being
   predicted.

3. Ownership costs are lumpy. An annual insurance premium is not a monthly cost, but
   over a year it behaves like one, so non-fuel spending is amortised rather than
   predicted to recur on the month it last happened.

Everything here is an estimate and the endpoint says so: the response carries how much
history it had, and a confidence the client shows rather than hiding.
"""

from calendar import monthrange
from datetime import date, timedelta

# Consumption multipliers by month, January first. Normalised to a mean of 1.0 at
# import, so a curve describes only the *shape* of the year and never quietly scales
# the whole projection up or down.
#
# Northern-hemisphere temperate climate. These are assumptions, not measurements from
# this account — an account with a year of its own history blends its observed shape
# into them (see _seasonal_profile).
_RAW_SEASONALITY = {
    # Cabin heat and pack conditioning both come out of the battery.
    'electric': [1.28, 1.24, 1.12, 1.02, 0.94, 0.90, 0.90, 0.90, 0.94, 1.04, 1.16, 1.26],
    # Waste heat covers the cabin; what is left is cold starts, winter tyres, dense air.
    'petrol': [1.14, 1.12, 1.06, 1.01, 0.97, 0.95, 0.95, 0.95, 0.97, 1.02, 1.08, 1.12],
    'diesel': [1.15, 1.13, 1.06, 1.01, 0.97, 0.94, 0.94, 0.94, 0.97, 1.02, 1.09, 1.13],
    # Runs on the battery when it can, so it sits between the two.
    'hybrid': [1.21, 1.18, 1.09, 1.02, 0.95, 0.92, 0.92, 0.92, 0.95, 1.03, 1.12, 1.19],
    # A fuel cell produces waste heat like an engine, but the stack itself prefers to
    # be warm, so it lands near the hybrid rather than the battery car.
    'hydrogen': [1.20, 1.17, 1.09, 1.02, 0.96, 0.93, 0.93, 0.93, 0.96, 1.03, 1.11, 1.18],
}


def _normalise(factors: list[float]) -> list[float]:
    mean = sum(factors) / len(factors)
    return [factor / mean for factor in factors]


SEASONALITY = {fuel: _normalise(values) for fuel, values in _RAW_SEASONALITY.items()}
DEFAULT_CURVE = SEASONALITY['petrol']

# How far back to look. A full year captures one complete cycle; more than that risks
# projecting a car or a commute the account no longer has.
LOOKBACK_DAYS = 365

# Below this there is nothing worth extrapolating from.
MIN_HISTORY_DAYS = 21
MIN_SESSIONS = 4

# Weight given to an account's own observed seasonal shape once it has a full year.
# Half, not all: twelve months is one sample of each month, and a single unusual
# February should not redraw the curve.
OWN_SEASONALITY_WEIGHT = 0.5


def _curve_for(fuel_type: str) -> list[float]:
    return SEASONALITY.get((fuel_type or '').lower(), DEFAULT_CURVE)


def _months_between(start: date, end: date):
    """Every month start from `start`'s month through `end`'s month."""
    cursor = start.replace(day=1)
    while cursor <= end:
        yield cursor
        cursor = (cursor.replace(day=28) + timedelta(days=7)).replace(day=1)


def _fetch_history(db, user_id: str, since: date):
    """Session events with an odometer, and non-session spending, for live vehicles."""
    cur = db.cursor()
    cur.execute(
        """
        SELECT ve.vehicle_id, v.fuel_type, ve.occurred_at, ve.total_cost, ve.odometer_km
        FROM vehicle_events ve
        JOIN vehicles v ON v.id = ve.vehicle_id AND v.user_id = ve.user_id
        WHERE ve.user_id = %s
          AND v.is_archived = FALSE
          AND ve.event_type IN ('charging', 'fueling')
          AND ve.occurred_at >= %s
        ORDER BY ve.vehicle_id, ve.occurred_at, ve.id;
        """,
        (user_id, since.isoformat()),
    )
    sessions = cur.fetchall()

    cur.execute(
        """
        SELECT COALESCE(SUM(ve.total_cost), 0) AS total, COUNT(*) AS count
        FROM vehicle_events ve
        LEFT JOIN vehicles v ON v.id = ve.vehicle_id AND v.user_id = ve.user_id
        WHERE ve.user_id = %s
          AND COALESCE(v.is_archived, FALSE) = FALSE
          AND ve.event_type NOT IN ('charging', 'fueling')
          AND ve.occurred_at >= %s;
        """,
        (user_id, since.isoformat()),
    )
    expenses = cur.fetchone() or {'total': 0, 'count': 0}
    return sessions, expenses


def _per_vehicle_baselines(sessions):
    """De-seasonalised cost per km and km per day, per vehicle.

    Distance between two consecutive readings is attributed to the later one, and both
    the distance and its cost are divided by the seasonal factor of the month it fell
    in. Averaging those gives a baseline that means "a typical month", not "the months
    this account happened to record".
    """
    by_vehicle = {}
    for row in sessions:
        by_vehicle.setdefault(row['vehicle_id'], []).append(row)

    baselines = {}
    for vehicle_id, rows in by_vehicle.items():
        curve = _curve_for(rows[0].get('fuel_type'))
        previous_odometer = None
        previous_at = None
        adjusted_cost = 0.0
        distance = 0.0
        span_days = 0.0

        for row in rows:
            odometer = row.get('odometer_km')
            occurred = row['occurred_at']
            cost = float(row.get('total_cost') or 0)
            factor = curve[occurred.month - 1]

            if odometer is not None and previous_odometer is not None:
                step = float(odometer) - float(previous_odometer)
                if step > 0:
                    distance += step / factor
                    adjusted_cost += cost / factor
                    span_days += max((occurred - previous_at).total_seconds() / 86400.0, 0.0)

            if odometer is not None:
                previous_odometer = float(odometer)
                previous_at = occurred

        if distance <= 0 or span_days <= 0:
            continue

        baselines[vehicle_id] = {
            'fuel_type': rows[0].get('fuel_type'),
            'cost_per_km': adjusted_cost / distance,
            'km_per_day': distance / span_days,
            'sessions': len(rows),
            'span_days': span_days,
        }
    return baselines


def _seasonal_profile(sessions, baselines):
    """Blend the account's own observed shape into the reference curve, if it has one.

    Needs twelve distinct months before it is worth listening to; below that the
    reference curve is used unchanged.
    """
    monthly_cost = {}
    monthly_distance = {}
    by_vehicle = {}
    for row in sessions:
        by_vehicle.setdefault(row['vehicle_id'], []).append(row)

    for rows in by_vehicle.values():
        previous_odometer = None
        for row in rows:
            odometer = row.get('odometer_km')
            if odometer is not None and previous_odometer is not None:
                step = float(odometer) - float(previous_odometer)
                if step > 0:
                    month = row['occurred_at'].month
                    monthly_distance[month] = monthly_distance.get(month, 0.0) + step
                    monthly_cost[month] = monthly_cost.get(month, 0.0) + float(row.get('total_cost') or 0)
            if odometer is not None:
                previous_odometer = float(odometer)

    observed_months = [m for m in monthly_distance if monthly_distance[m] > 0]
    if len(observed_months) < 12:
        return None, len(observed_months)

    rates = {m: monthly_cost[m] / monthly_distance[m] for m in observed_months}
    mean_rate = sum(rates.values()) / len(rates)
    if mean_rate <= 0:
        return None, len(observed_months)

    own = [rates[m] / mean_rate for m in range(1, 13)]

    # Blend against whichever reference curve the fleet mostly is.
    fuels = [b['fuel_type'] for b in baselines.values()] or ['petrol']
    reference = _curve_for(max(set(fuels), key=fuels.count))
    blended = [
        OWN_SEASONALITY_WEIGHT * own[i] + (1 - OWN_SEASONALITY_WEIGHT) * reference[i]
        for i in range(12)
    ]
    return _normalise(blended), len(observed_months)


def build_forecast(db, user_id: str, today: date | None = None) -> dict:
    today = today or date.today()
    year_end = date(today.year, 12, 31)
    since = today - timedelta(days=LOOKBACK_DAYS)

    sessions, expense_row = _fetch_history(db, user_id, since)
    baselines = _per_vehicle_baselines(sessions)

    history_days = 0.0
    if sessions:
        history_days = (sessions[-1]['occurred_at'].date() - sessions[0]['occurred_at'].date()).days

    if not baselines or history_days < MIN_HISTORY_DAYS or len(sessions) < MIN_SESSIONS:
        return {
            'available': False,
            'reason': 'Not enough history yet. A few weeks of records with odometer readings are needed.',
            'months': [],
            'summary': None,
            'basis': {
                'history_days': int(history_days),
                'sessions': len(sessions),
                'vehicles': len(baselines),
            },
        }

    blended_curve, observed_months = _seasonal_profile(sessions, baselines)

    # Non-fuel spending amortised over the window it was observed in.
    window_days = max(history_days, 1)
    expense_per_day = float(expense_row.get('total') or 0) / window_days

    months = []
    for month_start in _months_between(today, year_end):
        days_in_month = monthrange(month_start.year, month_start.month)[1]
        month_end = month_start.replace(day=days_in_month)

        # The month already under way is only forecast from tomorrow onwards; what has
        # happened in it is already in the actuals the chart draws.
        if month_start.month == today.month and month_start.year == today.year:
            days = (month_end - today).days
            partial = True
        else:
            days = days_in_month
            partial = False
        if days <= 0:
            continue

        session_cost = 0.0
        distance_km = 0.0
        for baseline in baselines.values():
            curve = blended_curve or _curve_for(baseline['fuel_type'])
            factor = curve[month_start.month - 1]
            vehicle_distance = baseline['km_per_day'] * days
            distance_km += vehicle_distance
            session_cost += vehicle_distance * baseline['cost_per_km'] * factor

        expense_cost = expense_per_day * days
        months.append({
            'period': month_start.isoformat(),
            'partial': partial,
            'days_forecast': days,
            'distance_km': round(distance_km, 1),
            'session_cost': round(session_cost, 2),
            'expense_cost': round(expense_cost, 2),
            'total_cost': round(session_cost + expense_cost, 2),
        })

    remaining = sum(month['total_cost'] for month in months)

    # Confidence is about how much history stands behind the numbers, not how close
    # they will turn out to be. Nothing here can promise the latter.
    if history_days >= 300 and observed_months >= 12:
        confidence = 'high'
    elif history_days >= 90:
        confidence = 'medium'
    else:
        confidence = 'low'

    return {
        'available': True,
        'year': today.year,
        'months': months,
        'summary': {
            'remaining_cost': round(remaining, 2),
            'months_ahead': len(months),
        },
        'basis': {
            'history_days': int(history_days),
            'sessions': len(sessions),
            'vehicles': len(baselines),
            'observed_months': observed_months,
            'seasonality': 'blended' if blended_curve else 'reference',
            'confidence': confidence,
            'expense_per_month': round(expense_per_day * 30, 2),
        },
    }
