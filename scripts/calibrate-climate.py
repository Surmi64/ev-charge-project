#!/usr/bin/env python3
"""Print the temperature-derived seasonality curves next to the table they replaced.

The point is a sanity check, not a test: the hand-written table in the old forecast.py
encoded published fleet winter penalties for a temperate-continental climate, so the
derived curve for that zone should land close to it. A large divergence means the
coefficients in `climate._THERMAL` have drifted away from the evidence they came from.

    python3 scripts/calibrate-climate.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.climate import ZONES, curve_for  # noqa: E402

# The curves forecast.py carried before this was derived from temperature.
PREVIOUS = {
    'electric': [1.28, 1.24, 1.12, 1.02, 0.94, 0.90, 0.90, 0.90, 0.94, 1.04, 1.16, 1.26],
    'petrol': [1.14, 1.12, 1.06, 1.01, 0.97, 0.95, 0.95, 0.95, 0.97, 1.02, 1.08, 1.12],
    'diesel': [1.15, 1.13, 1.06, 1.01, 0.97, 0.94, 0.94, 0.94, 0.97, 1.02, 1.09, 1.13],
    'hybrid': [1.21, 1.18, 1.09, 1.02, 0.95, 0.92, 0.92, 0.92, 0.95, 1.03, 1.12, 1.19],
    'hydrogen': [1.20, 1.17, 1.09, 1.02, 0.96, 0.93, 0.93, 0.93, 0.96, 1.03, 1.11, 1.18],
}

MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def _normalise(values):
    mean = sum(values) / len(values)
    return [value / mean for value in values]


def show_calibration():
    print('Temperate continental — derived vs the table it replaced\n')
    print(f"{'':10}{''.join(f'{m:>7}' for m in MONTHS)}{'max err':>10}")
    worst = 0.0
    for fuel, previous in PREVIOUS.items():
        derived = curve_for('temperate_continental', fuel, None)
        reference = _normalise(previous)
        error = max(abs(d - r) for d, r in zip(derived, reference))
        worst = max(worst, error)
        print(f'{fuel:10}' + ''.join(f'{value:7.3f}' for value in derived) + f'{error:10.3f}')
        print(f"{'  was':10}" + ''.join(f'{value:7.3f}' for value in reference))
    print(f'\nworst deviation across all fuel types: {worst:.3f}')
    return worst


def show_zones():
    print('\n\nBattery car, unknown heat pump — one row per zone\n')
    print(f"{'':24}{''.join(f'{m:>7}' for m in MONTHS)}{'spread':>9}")
    for key in ZONES:
        curve = curve_for(key, 'electric', None)
        print(f'{key:24}' + ''.join(f'{value:7.3f}' for value in curve)
              + f'{max(curve) / min(curve) - 1:8.0%}')


def show_heat_pump():
    """How much the heat pump answer changes the *shape* of the year, by zone.

    Not how much it saves. The curves are normalised, so the level is gone by
    construction — it lives in the account's own cost per kilometre. What is shown is
    how much flatter the year gets, and the interesting result is that a heat pump
    flattens a Mediterranean year noticeably and a subarctic one barely at all, because
    at −20 °C its COP has collapsed to resistive parity.
    """
    print('\n\nHow much a heat pump flattens the year, by zone (battery car)\n')
    print(f"{'':24}{'resistive':>11}{'heat pump':>11}{'flattening':>12}")
    for key in ZONES:
        resistive = max(curve_for(key, 'electric', False)) / min(curve_for(key, 'electric', False)) - 1
        pump = max(curve_for(key, 'electric', True)) / min(curve_for(key, 'electric', True)) - 1
        change = (resistive - pump) / resistive if resistive > 0.001 else 0.0
        print(f'{key:24}{resistive:10.0%} {pump:10.0%} {change:11.0%}')


if __name__ == '__main__':
    worst = show_calibration()
    show_zones()
    show_heat_pump()
    # Loose on purpose: the table was itself a rounded summary, so agreement to a few
    # percent is all that is meaningful. Anything larger wants explaining.
    sys.exit(0 if worst < 0.05 else 1)
