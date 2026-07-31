"""Seasonal consumption curves derived from temperature, not from a hand-drawn table.

`forecast.py` used to carry one hard-coded twelve-month curve per fuel type, written
for a northern-hemisphere temperate climate. That is wrong for most of the world in two
directions at once: a Singapore account has no winter to be penalised for, and a
Helsinki one has a far deeper one than the table admits. In the southern hemisphere the
table is not merely inaccurate, it is inverted.

So the curves are computed instead, from monthly temperature normals for a climate
zone and a small physical model of where the extra energy goes.

## The model

Per-kilometre energy is treated as a constant traction term plus three
temperature-driven terms:

    e(T) = 1 + heating(T) + cold(T) + cooling(T)

    heating(T) = h · (T_cabin − T)⁺ / COP(T)   cabin heat, only a battery car pays for it
    cold(T)    = c · (T_cold − T)⁺             warm-up, dense air, winter tyres, rolling drag
    cooling(T) = a · (T − T_hot)⁺              air conditioning

A combustion engine heats the cabin with waste heat it produces anyway, so `h` is zero
for it and its cold-weather penalty sits almost entirely in `cold` — warm-up enrichment
and friction. A battery car has to make that heat, which is why its `h` dominates.

## Why the month's mean temperature is not enough

Every term above is a hinge, and a hinge is convex. Feeding it the monthly *mean* and
feeding it each day and averaging give different answers, and by Jensen's inequality the
mean-first answer is always the lower one. A month averaging 16 °C with days ranging
from 6 to 26 spends real energy on both heating and cooling; evaluated at its mean it
spends nothing on either.

So each month is integrated over a normal distribution of daily means, with a per-zone
spread that widens toward that zone's own winter — continental climates swing far more
day to day in January than maritime ones do, and far more than any month in the tropics.

## Why the heat pump answer belongs here

A heat pump is not a fixed discount. Its COP collapses as it gets colder, and below
about −12 °C it is doing little better than a resistive element. Modelling it as a
temperature-dependent divisor rather than a flat multiplier is what makes it show up
as a large effect in Oslo, a modest one in Budapest and almost none in Lisbon — which
is the whole reason to derive curves from temperature rather than tabulate them.

What the answer does *not* do is make the forecast cheaper. These curves are normalised
to a mean of 1 and carry only the shape of the year; the level comes from the account's
own cost per kilometre, which already includes whatever its car actually does. A heat
pump changes when the money is spent, not how much of it there is — and in a subarctic
zone it barely changes even that, because at −20 °C it has no advantage left to give.

The numbers below are calibrated so that the temperate-continental zone reproduces the
published fleet penalties the previous hand-written table was built from (roughly a
quarter to a third for a battery car, nearer a tenth for a combustion one). Everything
here is still an estimate, and an account with a full year of its own history has that
shape blended in on top — see `forecast._curve_for_vehicle`.
"""

from functools import lru_cache
from math import exp, pi, sqrt

# Monthly mean daily temperatures in °C, January first, from published 1991-2020
# normals for a city representative of the zone. `spread_winter` / `spread_summer` are
# the standard deviation of *daily* means within a month — how much one day differs
# from another, not the diurnal range.
ZONES = {
    'temperate_continental': {
        'label': 'Temperate continental',
        'description': 'Central and Eastern Europe, the northern US Midwest. Cold winters, warm summers.',
        'example': 'Budapest, Vienna, Chicago',
        'monthly_c': [0.4, 2.2, 6.5, 12.0, 16.8, 20.2, 22.1, 21.5, 16.8, 11.3, 5.5, 1.4],
        'spread_winter': 5.0,
        'spread_summer': 3.0,
    },
    'temperate_maritime': {
        'label': 'Temperate maritime',
        'description': 'North-western Europe and the Pacific North-West. Mild and even, little seasonal swing.',
        'example': 'London, Amsterdam, Seattle',
        'monthly_c': [5.2, 5.3, 7.6, 9.9, 13.3, 16.4, 18.7, 18.5, 15.7, 12.0, 8.0, 5.5],
        'spread_winter': 3.4,
        'spread_summer': 2.6,
    },
    'nordic': {
        'label': 'Nordic',
        'description': 'Scandinavia and the Baltics. Long cold winters, short mild summers.',
        'example': 'Stockholm, Oslo, Tallinn',
        'monthly_c': [-2.8, -3.0, 0.1, 4.6, 10.4, 15.0, 17.2, 16.2, 11.9, 7.1, 2.4, -1.0],
        'spread_winter': 5.6,
        'spread_summer': 3.0,
    },
    'subarctic': {
        'label': 'Subarctic / severe continental',
        'description': 'Inland Canada, northern Scandinavia, Siberia. Deep winters well below freezing.',
        'example': 'Montreal, Helsinki, Winnipeg',
        'monthly_c': [-9.7, -7.7, -2.0, 6.4, 13.4, 18.6, 21.2, 20.0, 15.3, 8.5, 1.6, -6.5],
        'spread_winter': 6.4,
        'spread_summer': 3.2,
    },
    'mediterranean': {
        'label': 'Mediterranean',
        'description': 'Southern Europe, coastal California. Mild wet winters, hot dry summers.',
        'example': 'Rome, Barcelona, Athens',
        'monthly_c': [8.1, 8.8, 11.2, 14.0, 18.4, 22.6, 25.4, 25.5, 21.6, 17.3, 12.3, 9.0],
        'spread_winter': 3.2,
        'spread_summer': 2.6,
    },
    'subtropical': {
        'label': 'Humid subtropical',
        'description': 'The US South-East, southern China, northern Australia. Long hot summers, short mild winters.',
        'example': 'Atlanta, Houston, Shanghai',
        'monthly_c': [11.7, 13.9, 17.8, 21.4, 25.3, 28.3, 29.4, 29.4, 26.7, 21.7, 16.4, 12.5],
        'spread_winter': 4.4,
        'spread_summer': 2.2,
    },
    'desert_hot': {
        'label': 'Hot desert',
        'description': 'The Gulf, the US South-West, North Africa. Air conditioning is the dominant load.',
        'example': 'Dubai, Phoenix, Riyadh',
        'monthly_c': [19.0, 20.0, 23.0, 27.0, 32.0, 35.0, 36.0, 36.0, 33.0, 29.0, 23.5, 19.5],
        'spread_winter': 2.6,
        'spread_summer': 1.8,
    },
    'tropical': {
        'label': 'Tropical',
        'description': 'Near the equator. Effectively no seasons, so almost no seasonal variation to predict.',
        'example': 'Singapore, Jakarta, Lagos',
        'monthly_c': [26.6, 27.2, 27.6, 28.0, 28.4, 28.3, 27.9, 27.8, 27.7, 27.5, 27.0, 26.6],
        'spread_winter': 1.2,
        'spread_summer': 1.2,
    },
    'oceanic_south': {
        'label': 'Southern temperate',
        'description': 'Southern Australia, New Zealand, central Chile. Seasons run opposite to the north.',
        'example': 'Melbourne, Christchurch, Santiago',
        'monthly_c': [21.0, 21.3, 19.6, 16.4, 13.2, 10.6, 10.0, 11.2, 13.3, 15.3, 17.4, 19.3],
        'spread_winter': 3.4,
        'spread_summer': 3.6,
    },
}

# Applies when nobody has said where the account is. It is the zone the previous
# hard-coded curves were written for, so an account that never answers keeps the
# behaviour it had before this module existed.
DEFAULT_ZONE = 'temperate_continental'

# Cabin heating runs toward this; below it, the difference has to come from somewhere.
CABIN_TARGET_C = 20.0
# Warm-up, denser air, winter tyres and stiffer lubricant all set in above freezing,
# which is why this threshold is not 0.
COLD_PENALTY_C = 15.0
# Air conditioning is not usually asked for below this.
COOLING_THRESHOLD_C = 24.0

# Coefficients per °C·hinge of the three terms, calibrated against published fleet
# winter penalties for the temperate-continental zone. See `scripts/calibrate-climate.py`,
# which prints the resulting curves next to the table they replaced.
_THERMAL = {
    # Cabin heat and pack conditioning both come out of the battery.
    'electric': {'heating': 0.0210, 'cold': 0.0110, 'cooling': 0.0090},
    # Waste heat covers the cabin for free; the penalty is warm-up and drag.
    'petrol': {'heating': 0.0, 'cold': 0.0145, 'cooling': 0.0100},
    # Compression ignition is slower to warm up and less happy doing it.
    'diesel': {'heating': 0.0, 'cold': 0.0165, 'cooling': 0.0095},
    # Runs on the battery when it can, so it pays part of a battery car's heating bill.
    'hybrid': {'heating': 0.0105, 'cold': 0.0130, 'cooling': 0.0095},
    # A fuel cell makes waste heat like an engine, but the stack wants to be warm.
    'hydrogen': {'heating': 0.0060, 'cold': 0.0150, 'cooling': 0.0095},
}
DEFAULT_THERMAL = _THERMAL['petrol']

# Heat pump coefficient of performance against ambient temperature. Real automotive
# systems manage roughly 3 at 10 °C and little better than a resistive element by
# −12 °C, where most fall back to one anyway; hence the floor at 1.0.
_COP_AT_FLOOR_C = -12.0
_COP_SLOPE = 0.09
_COP_CEILING = 3.2

# What fraction of battery cars on the road have a heat pump. Used only when the
# vehicle's own answer is unknown, so an unanswered car sits on the fleet average
# rather than being assumed one way.
HEAT_PUMP_SHARE = 0.55

# Fixed-node quadrature over the within-month temperature distribution. Eleven nodes
# across ±2.5σ is far more resolution than the input normals justify, and the whole
# table is computed once per (zone, fuel, heat pump) and cached.
_QUADRATURE = None


def _quadrature():
    """Normal-distribution sample points and weights, computed once."""
    global _QUADRATURE
    if _QUADRATURE is None:
        nodes = [-2.5 + 0.5 * i for i in range(11)]
        raw = [exp(-0.5 * z * z) / sqrt(2 * pi) for z in nodes]
        total = sum(raw)
        _QUADRATURE = list(zip(nodes, [w / total for w in raw]))
    return _QUADRATURE


def _cop(temperature_c: float) -> float:
    """Heat pump COP at a given ambient temperature, floored at resistive parity."""
    return min(max(1.0, 1.0 + _COP_SLOPE * (temperature_c - _COP_AT_FLOOR_C)), _COP_CEILING)


def _energy_at(temperature_c: float, thermal: dict, has_heat_pump) -> float:
    """Relative per-km energy at one ambient temperature."""
    heating_demand = max(CABIN_TARGET_C - temperature_c, 0.0)
    if thermal['heating'] and heating_demand:
        if has_heat_pump is True:
            divisor = _cop(temperature_c)
        elif has_heat_pump is False:
            divisor = 1.0
        else:
            # Unknown: the fleet mix, taken on the delivered heat rather than on the
            # finished curve, so the blend stays inside the physics.
            divisor = 1.0 / (HEAT_PUMP_SHARE / _cop(temperature_c) + (1 - HEAT_PUMP_SHARE))
        heating = thermal['heating'] * heating_demand / divisor
    else:
        heating = 0.0

    cold = thermal['cold'] * max(COLD_PENALTY_C - temperature_c, 0.0)
    cooling = thermal['cooling'] * max(temperature_c - COOLING_THRESHOLD_C, 0.0)
    return 1.0 + heating + cold + cooling


def _spread_for_month(zone: dict, month_index: int) -> float:
    """Day-to-day spread, widening toward that zone's own coldest month.

    Interpolating on temperature rather than on the calendar means the southern
    hemisphere gets its wide spread in July without needing a hemisphere flag.
    """
    temperatures = zone['monthly_c']
    coldest, warmest = min(temperatures), max(temperatures)
    if warmest - coldest < 0.1:
        return zone['spread_summer']
    position = (warmest - temperatures[month_index]) / (warmest - coldest)
    return zone['spread_summer'] + (zone['spread_winter'] - zone['spread_summer']) * position


def _normalise(factors: list[float]) -> list[float]:
    mean = sum(factors) / len(factors)
    return [factor / mean for factor in factors]


@lru_cache(maxsize=256)
def curve_for(zone_key: str | None, fuel_type: str | None, has_heat_pump: bool | None) -> tuple:
    """Twelve monthly consumption multipliers, January first, normalised to mean 1.

    Normalised on purpose: the curve describes only the *shape* of the year. Its level
    comes from the account's own cost per kilometre, so a zone can never quietly scale
    a whole forecast up or down.
    """
    zone = ZONES.get(zone_key or '', ZONES[DEFAULT_ZONE])
    thermal = _THERMAL.get((fuel_type or '').lower(), DEFAULT_THERMAL)
    # Only a battery car's heating bill responds to the answer; asking a diesel owner
    # would be strange, and treating their answer as meaningful would be wrong.
    if not thermal['heating']:
        has_heat_pump = None

    monthly = []
    for month_index in range(12):
        mean = zone['monthly_c'][month_index]
        spread = _spread_for_month(zone, month_index)
        monthly.append(sum(
            weight * _energy_at(mean + z * spread, thermal, has_heat_pump)
            for z, weight in _quadrature()
        ))
    return tuple(_normalise(monthly))


def zone_options() -> list[dict]:
    """The choices offered in settings, so the client keeps no copy of its own."""
    return [
        {
            'value': key,
            'label': zone['label'],
            'description': zone['description'],
            'example': zone['example'],
            # Handy for a preview: how much more a battery car uses in that zone's
            # heaviest month than its lightest, on the population heat-pump mix. Not
            # called a winter penalty, because in a hot desert the heavy end is August.
            'seasonal_spread': round(
                max(curve_for(key, 'electric', None)) / min(curve_for(key, 'electric', None)) - 1,
                3,
            ),
        }
        for key, zone in ZONES.items()
    ]


def resolve_zone(zone_key: str | None) -> str:
    return zone_key if zone_key in ZONES else DEFAULT_ZONE
