"""What the same distance would have cost in a petrol or diesel car.

The arithmetic is one line — distance x consumption x price — so everything worth
writing down is about what the number does and does not claim.

**It compares fuel with fuel.** The line sits against driving spend, not total cost.
A combustion car still needs insurance, tax and servicing, and most of those it needs
*more* of; putting a fuel-only figure next to a total that includes them would flatter
the comparison in a direction the data cannot support.

**It uses the account's own distance**, whatever the chart is currently showing. No
filtering by fuel type: if the chart is showing a petrol car, the line lands close to
its actual spend, which is honest — that is what the comparison means for that car.
Silently dropping combustion vehicles from the distance would make the line disagree
with the bars beside it for no reason the user could see.

**The price is a real one where possible.** An account that fuels anything at all has
its own price per litre in its records, and that beats any figure this module could
invent. Only when there is nothing to observe does it fall back to what the account
configured, and when that is unset too the comparison is simply not offered. There is
no built-in default price: fuel costs differ by more than tenfold across the currencies
this app supports, and a guess would be indistinguishable on screen from a measurement.

Consumption has no such fallback available — an account that has stopped burning fuel
has no record of what a petrol car would drink — so it is configured, defaulting to
DEFAULT_CONSUMPTION_L_100KM, which is stated in the response rather than hidden.
"""

# A mid-size petrol hatchback in mixed driving. Only a starting point: it is shown in
# the settings field as the value in use, so it can be argued with.
DEFAULT_CONSUMPTION_L_100KM = 7.0


def observed_fuel_price(cur, user_id: str, start_date=None, end_date=None):
    """The account's own average price per litre, or None if it has never fuelled.

    Averaged over spend rather than over the individual prices: a 45-litre fill and a
    5-litre top-up should not count equally toward what fuel costs this account.
    Hydrogen is excluded — it is sold by the kilogram and lands in the same column, so
    including it would drag the average by a factor of four.
    """
    filters = [
        've.user_id = %s',
        "ve.event_type = 'fueling'",
        've.fuel_liters > 0',
        've.total_cost > 0',
        "COALESCE(v.fuel_type, '') <> 'hydrogen'",
    ]
    params: list[object] = [user_id]

    if start_date is not None:
        filters.append('ve.occurred_at >= %s')
        params.append(start_date.isoformat())
    if end_date is not None:
        filters.append('ve.occurred_at < %s')
        params.append(end_date.isoformat())

    cur.execute(
        f"""
        SELECT SUM(ve.total_cost) / NULLIF(SUM(ve.fuel_liters), 0) AS price_per_litre,
               COUNT(*) AS fill_ups
        FROM vehicle_events ve
        LEFT JOIN vehicles v ON v.id = ve.vehicle_id AND v.user_id = ve.user_id
        WHERE {' AND '.join(filters)};
        """,
        tuple(params),
    )
    row = cur.fetchone() or {}
    price = row.get('price_per_litre')
    return (float(price), int(row.get('fill_ups') or 0)) if price else (None, 0)


def resolve_basis(cur, user_id: str, profile: dict, start_date=None, end_date=None) -> dict:
    """Decide which consumption and price the comparison should use, and say why.

    The `source` fields exist so the client can label the line honestly. "Your own
    fill-ups, averaged" and "the figure you entered" deserve different amounts of
    trust, and only the server knows which one it used.
    """
    configured_price = profile.get('reference_fuel_price')
    configured_consumption = profile.get('reference_consumption_l_100km')

    observed_price, fill_ups = observed_fuel_price(cur, user_id, start_date, end_date)

    if observed_price is not None:
        price, price_source = observed_price, 'observed'
    elif configured_price is not None:
        price, price_source = float(configured_price), 'configured'
    else:
        price, price_source = None, 'missing'

    if configured_consumption is not None:
        consumption, consumption_source = float(configured_consumption), 'configured'
    else:
        consumption, consumption_source = DEFAULT_CONSUMPTION_L_100KM, 'default'

    return {
        'available': price is not None,
        'fuel_price_per_litre': round(price, 2) if price is not None else None,
        'fuel_price_source': price_source,
        'observed_fill_ups': fill_ups,
        'consumption_l_100km': consumption,
        'consumption_source': consumption_source,
    }


def equivalent_cost(distance_km: float, basis: dict) -> float | None:
    """What `distance_km` would have cost as fuel, or None when there is no price."""
    if not basis.get('available'):
        return None
    litres = (float(distance_km or 0) / 100.0) * basis['consumption_l_100km']
    return round(litres * basis['fuel_price_per_litre'], 2)


def annotate_trend(rows: list[dict], basis: dict) -> list[dict]:
    """Add the comparison to each trend bucket.

    The key is absent rather than null when there is no price, so Recharts draws no
    line at all instead of a flat one along zero — a zero here would read as "petrol
    would have been free".
    """
    if not basis.get('available'):
        return rows
    for row in rows:
        # A bucket with no measured distance is almost always a missing odometer
        # reading rather than a car that sat still — the very first bucket of an
        # account has nothing to difference against, so it always reports zero km.
        # Writing 0 there would draw the line down to the axis and say petrol would
        # have been free that month. Leaving the key out breaks the line instead,
        # which is what "we do not know" should look like.
        if float(row.get('total_distance_km') or 0) <= 0:
            continue
        row['petrol_equivalent_cost'] = equivalent_cost(row.get('total_distance_km'), basis)
    return rows
