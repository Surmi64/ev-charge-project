"""Projected running cost for the rest of the calendar year.

The hard part is not the arithmetic, it is not fooling yourself. Three things make a
naive "average the last few months and repeat it" projection wrong:

1. Consumption is seasonal, and far more so for an electric car. A combustion engine
   heats the cabin with waste heat it produces anyway; a battery car spends stored
   energy on it, and additionally warms the pack itself. How large that swing is
   depends entirely on where the car is: `climate.py` derives the twelve monthly
   multipliers from the account's climate zone and the vehicle's heat pump answer,
   rather than assuming one temperate northern-hemisphere year for everybody.

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

try:
    from backend.climate import curve_for, resolve_zone
    from backend.db import column_exists
except ModuleNotFoundError:
    from climate import curve_for, resolve_zone
    from db import column_exists


def _normalise(factors: list[float]) -> list[float]:
    mean = sum(factors) / len(factors)
    return [factor / mean for factor in factors]


# How far back to look. A full year captures one complete cycle; more than that risks
# projecting a car or a commute the account no longer has.
LOOKBACK_DAYS = 365

# Below this there is nothing worth extrapolating from.
MIN_HISTORY_DAYS = 21
MIN_SESSIONS = 4

# Ceiling on how far an account's own observed shape can pull a month away from the
# reference curve. Never all the way: twelve months of history is one sample of each
# month, and a single unusual February should not redraw the year.
OWN_SEASONALITY_WEIGHT = 0.5

# Distance at which a month is trusted half as much as the ceiling allows. A month with
# 1500 km behind it says something; a month with 80 km is one trip, and reading a
# seasonal factor off it is reading noise. Each month is shrunk toward the reference by
# its own evidence rather than the whole curve sharing one flat weight, because thin
# months are exactly the ones that produce the wild values.
OWN_SEASONALITY_HALF_KM = 1500.0

# A mistyped odometer reading costs twice, and the second time is the expensive one.
#
# This account has a reading of 73244 where it should say 76244. Taken at face value it
# is a 2861 km reversal — but the damage is what happens next: the following genuine
# reading of 76253 is then differenced against the typo and books 3009 km that were
# never driven. That one phantom made January the account's biggest-distance month,
# dropped its observed winter consumption to 0.36 kWh/km-relative where the physics says
# 1.22, and — because the month now looked evidence-rich — earned more trust in the
# blend than any real month had.
#
# Odometers only go up. So a reading below the highest seen is treated as a typo and
# skipped rather than adopted as the new baseline, which is what turns one bad number
# into two bad numbers. Two consecutive low readings are something else — a replaced
# cluster or a corrected history — and rebaseline instead of being discarded forever.
RESET_CONFIRMATIONS = 2

# Coarse backstop for a step that is monotonic and therefore passes the rule above, but
# still cannot have happened. Comfortably above a long day's drive.
MAX_KM_PER_DAY = 1500.0


def _odometer_steps(rows):
    """Yield (row, step_km, days) for each distance between readings worth believing.

    Shared by the baseline and the seasonal profile so the two cannot disagree about
    which distances are real — they are the numerator and denominator of the same
    estimate, and filtering them differently would bias every forecast built on it.
    """
    previous_odometer = None
    previous_at = None
    below = []

    for row in rows:
        if row.get('odometer_km') is None:
            continue
        odometer = float(row['odometer_km'])
        occurred = row['occurred_at']

        if previous_odometer is not None and odometer < previous_odometer:
            below.append((odometer, occurred))
            if len(below) >= RESET_CONFIRMATIONS:
                previous_odometer, previous_at = below[-1]
                below = []
            continue
        below = []

        if previous_odometer is not None:
            step = odometer - previous_odometer
            days = max((occurred - previous_at).total_seconds() / 86400.0, 0.0)
            if step > 0 and not (days > 0 and step / days > MAX_KM_PER_DAY):
                yield row, step, days

        previous_odometer = odometer
        previous_at = occurred


def _months_between(start: date, end: date):
    """Every month start from `start`'s month through `end`'s month."""
    cursor = start.replace(day=1)
    while cursor <= end:
        yield cursor
        cursor = (cursor.replace(day=28) + timedelta(days=7)).replace(day=1)


def _fetch_climate_zone(db, user_id: str):
    """The account's climate zone, or None if it predates the column or never answered."""
    if not column_exists(db, 'users', 'climate_zone'):
        return None
    cur = db.cursor()
    # users is outside RLS (login has to read it before an identity exists), so this
    # needs its own user_id predicate rather than relying on a policy.
    cur.execute('SELECT climate_zone FROM users WHERE id = %s;', (user_id,))
    row = cur.fetchone()
    return (row or {}).get('climate_zone')


def _fetch_history(db, user_id: str, since: date):
    """Session events with an odometer, and non-session spending, for live vehicles."""
    cur = db.cursor()
    # Tolerates a database that predates the column, in the same spirit as the other
    # column_exists checks; an absent column simply reads as "unanswered".
    heat_pump_column = 'v.has_heat_pump' if column_exists(db, 'vehicles', 'has_heat_pump') else 'NULL::boolean AS has_heat_pump'
    cur.execute(
        f"""
        SELECT ve.vehicle_id, v.fuel_type, {heat_pump_column}, ve.occurred_at, ve.total_cost,
               ve.odometer_km, ve.energy_kwh, ve.fuel_liters
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


def _per_vehicle_baselines(sessions, own_curve=None, zone=None, monthly_distance=None):
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
        curve = _curve_for_vehicle(rows[0].get('fuel_type'), rows[0].get('has_heat_pump'), own_curve, zone, monthly_distance)
        adjusted_cost = 0.0
        distance = 0.0
        span_days = 0.0

        for row, step, days in _odometer_steps(rows):
            factor = curve[row['occurred_at'].month - 1]
            distance += step / factor
            adjusted_cost += float(row.get('total_cost') or 0) / factor
            span_days += days

        if distance <= 0 or span_days <= 0:
            continue

        baselines[vehicle_id] = {
            'curve': curve,
            'fuel_type': rows[0].get('fuel_type'),
            'has_heat_pump': rows[0].get('has_heat_pump'),
            'cost_per_km': adjusted_cost / distance,
            'km_per_day': distance / span_days,
            'sessions': len(rows),
            'span_days': span_days,
        }
    return baselines


def _seasonal_profile(sessions):
    """The account's own observed seasonal shape, or None if it has too little history.

    Measured in *energy or fuel* per kilometre, not cost per kilometre. Consumption is
    what the seasons act on; price is not. An account that charges free at work over the
    summer, or that switched tariff in March, has a cost curve full of steps that have
    nothing to do with the weather — and reading those as seasonality projects last
    year's tariff history forward as if it were physics. This account's cost curve had
    months at 0.0 and 2.3 against a physical range of roughly 0.85 to 1.25.

    Each vehicle is normalised against its own mean before pooling, because kWh/km and
    L/km are not the same quantity and adding them would be meaningless. Months are
    pooled weighted by distance, so a month with 40 km in it does not count as much as
    one with 2000.

    Returns the shape alongside how much distance stands behind each month; the blend
    against a reference happens per vehicle in `_curve_for_vehicle`, because the
    reference depends on the vehicle -- a battery car with a heat pump has a flatter
    year than one without, and a fleet-wide blend would erase that difference.
    """
    by_vehicle = {}
    for row in sessions:
        by_vehicle.setdefault(row['vehicle_id'], []).append(row)

    # Sum of (this vehicle's relative consumption) x distance, per month, across the
    # fleet; divided at the end by the distance, giving a distance-weighted mean.
    weighted_rate = {}
    monthly_distance = {}

    for rows in by_vehicle.values():
        vehicle_distance = {}
        vehicle_quantity = {}
        # Energy is summed per month rather than checked per step. A single top-up is a
        # terrible estimate of what the previous leg used — people charge partially, and
        # to different states of charge — but over a month those cancel and the ratio
        # becomes a real consumption figure.
        for row, step, _days in _odometer_steps(rows):
            quantity = row.get('energy_kwh') if row.get('energy_kwh') is not None else row.get('fuel_liters')
            if quantity is None:
                continue
            month = row['occurred_at'].month
            vehicle_distance[month] = vehicle_distance.get(month, 0.0) + step
            vehicle_quantity[month] = vehicle_quantity.get(month, 0.0) + float(quantity)

        months = [m for m, km in vehicle_distance.items() if km > 0]
        if len(months) < 12:
            continue
        rates = {m: vehicle_quantity[m] / vehicle_distance[m] for m in months}
        mean_rate = sum(rates.values()) / len(rates)
        if mean_rate <= 0:
            continue

        for month in months:
            km = vehicle_distance[month]
            weighted_rate[month] = weighted_rate.get(month, 0.0) + (rates[month] / mean_rate) * km
            monthly_distance[month] = monthly_distance.get(month, 0.0) + km

    if len(monthly_distance) < 12:
        return None, len(monthly_distance), {}

    shape = _normalise([weighted_rate[m] / monthly_distance[m] for m in range(1, 13)])
    return shape, len(monthly_distance), monthly_distance


def _curve_for_vehicle(fuel_type, has_heat_pump, own_curve, zone=None, monthly_distance=None) -> list[float]:
    """The curve actually used for one vehicle, reference blended with own history.

    The reference comes from the account's climate zone and this vehicle's fuel type
    and heat pump answer; the account's own observed shape is blended in on top, month
    by month, in proportion to how much distance stands behind each one.

    The same curve divides the baseline on the way in and multiplies the projection on
    the way out. Using two different curves for those halves would leave a systematic
    bias that no amount of history could correct.
    """
    reference = list(curve_for(zone, fuel_type, has_heat_pump))
    if not own_curve:
        return reference

    monthly_distance = monthly_distance or {}
    blended = []
    for index in range(12):
        km = monthly_distance.get(index + 1, 0.0)
        weight = OWN_SEASONALITY_WEIGHT * km / (km + OWN_SEASONALITY_HALF_KM)
        blended.append(weight * own_curve[index] + (1 - weight) * reference[index])
    return _normalise(blended)


def build_forecast(db, user_id: str, today: date | None = None) -> dict:
    today = today or date.today()
    year_end = date(today.year, 12, 31)
    since = today - timedelta(days=LOOKBACK_DAYS)

    stored_zone = _fetch_climate_zone(db, user_id)
    zone = resolve_zone(stored_zone)

    sessions, expense_row = _fetch_history(db, user_id, since)
    # Derived before the baselines, because the baselines are de-seasonalised with the
    # very curve the projection will re-apply.
    own_curve, observed_months, monthly_distance = _seasonal_profile(sessions)
    baselines = _per_vehicle_baselines(sessions, own_curve, zone, monthly_distance)

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
            factor = baseline['curve'][month_start.month - 1]
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
            'seasonality': 'blended' if own_curve else 'reference',
            'climate_zone': zone,
            # So the client can offer to fix an assumption rather than presenting it as
            # a fact. A Melbourne account left on the default gets its year backwards.
            'climate_answered': bool(stored_zone),
            'confidence': confidence,
            'expense_per_month': round(expense_per_day * 30, 2),
        },
    }
