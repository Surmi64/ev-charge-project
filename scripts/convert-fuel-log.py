#!/usr/bin/env python3
"""Convert a hand-kept fuel log spreadsheet into the activity CSV the app imports.

The source is an export of the sheet that predates this app: Hungarian headers,
ISO-8859-2, US dates, and four derived columns (napok, Trip km, fogyasztás, Ft/KM)
that the app recomputes from the odometer anyway and that are therefore dropped.

    python3 scripts/convert-fuel-log.py jnr538.csv --vehicle Babzsi -o import.csv

What maps to what:

    Időpont   -> occurred_at   (M/D/YYYY in the sheet, ISO here)
    Liter     -> fuel_liters
    Km állás  -> odometer_km
    végösszeg -> amount, in HUF
    kút       -> source (the brand) and description (the site, verbatim)

The provider goes to `source` because that is the field backend/providers.py reads to
group records by operator — it is not a provenance marker unless it is one of the
handful of values that mean "where this row came from". Writing 'csv_import' there
instead would file every one of these under a provider named csv_import.

It is the *brand* by default, not the site: see BRANDS below. `--stations` keeps the
site name instead, which is finer but scatters one Shell across four providers.

`Trip km` is kept for one purpose: as a check against the odometer column, which is
where a hand-kept sheet accumulates typos. Rows where the two disagree are printed;
they are not corrected, because a trip meter reset and a missed fill look exactly the
same from here and only the person who drove it knows which it was.
"""
import argparse
import csv
import sys
from datetime import date, datetime

# The order backend/routers/activity.py writes on export and reads on import.
COLUMNS = [
    'activity_type', 'event_type', 'category', 'occurred_at', 'ended_at', 'amount',
    'currency', 'vehicle_id', 'vehicle_name', 'title', 'description', 'energy_kwh',
    'fuel_liters', 'odometer_km', 'source', 'battery_level_start', 'battery_level_end',
    'place_name', 'latitude', 'longitude',
]

SOURCE_COLUMNS = {'date': 1, 'liters': 3, 'odometer': 4, 'trip': 5, 'total': 7, 'station': 9}

# The sheet names a site, not a brand: "Shell Lidl", "Shell Rakamaz" and "Mol Tokaj"
# are one Shell, another Shell and a Mol. Left verbatim they arrive as separate
# providers, and "Shell Lidl" is worse than separate — backend/providers.py matches
# the account's existing charging vocabulary, where LIDL is a charging operator, so a
# Shell station files under LIDL. The brand goes to `source` and the site stays in the
# note, which is the same division of labour the location field produces.
BRANDS = ('Shell', 'Mol', 'Lukoil', 'TIPP', 'Patak tank')

# Odometer readings the sheet got wrong, by the date of the fill.
#
# Only one, and it is the one case where the sheet convicts itself twice over: on
# 2020-07-10 the reading advances 27 km on a 30 litre fill, while the trip column on
# that row says 387. Reading it as 198406 rather than 198046 makes that row's distance
# 387 exactly, *and* turns the next row's 933 km into 573, which is what its own trip
# column says. A digit transposition explains both; nothing else explains either.
#
# Corrections live here rather than in the source file so that the conversion stays
# reproducible from the sheet exactly as it was exported.
CORRECTIONS = {date(2020, 7, 10): 198406}


def parse(path, encoding):
    with open(path, encoding=encoding, newline='') as handle:
        rows = list(csv.reader(handle))
    # Row 0 is the header; the sheet then trails a block of empty numbered rows.
    return [row for row in rows[1:] if len(row) > 9 and row[SOURCE_COLUMNS['date']].strip()]


def brand_of(station):
    """The brand a site name starts with, or the site itself when it names no brand."""
    lowered = station.lower()
    for brand in BRANDS:
        if lowered.startswith(brand.lower()):
            return brand
    return station


def convert(rows, vehicle, currency, group_brands):
    out = []
    warnings = []
    previous = None

    for row in rows:
        value = lambda key: row[SOURCE_COLUMNS[key]].strip()  # noqa: E731
        occurred = datetime.strptime(value('date'), '%m/%d/%Y').date()
        odometer = float(value('odometer'))
        if occurred in CORRECTIONS:
            warnings.append(f'{occurred}: odometer corrected, {odometer:.0f} -> {CORRECTIONS[occurred]}')
            odometer = float(CORRECTIONS[occurred])
        station = ' '.join(value('station').split())

        if previous is not None:
            gap = odometer - previous
            trip = float(value('trip')) if value('trip') else None
            if gap <= 0:
                warnings.append(f'{occurred}: odometer does not advance ({previous:.0f} -> {odometer:.0f})')
            elif trip is not None and abs(gap - trip) > 1:
                warnings.append(f'{occurred}: odometer moved {gap:.0f} km, the sheet\'s trip column says {trip:.0f}')
        previous = odometer

        out.append({
            'activity_type': 'session',
            'event_type': 'fueling',
            'occurred_at': occurred.isoformat(),
            'amount': value('total'),
            'currency': currency,
            'vehicle_name': vehicle,
            'description': station,
            'fuel_liters': value('liters'),
            'odometer_km': f'{odometer:.0f}',
            'source': brand_of(station) if group_brands else station,
        })

    return out, warnings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('source')
    parser.add_argument('--vehicle', required=True, help='must match an active vehicle in the account')
    parser.add_argument('--currency', default='HUF')
    parser.add_argument(
        '--stations', action='store_true',
        help='keep the site name as the provider instead of grouping by brand',
    )
    parser.add_argument('--encoding', default='iso-8859-2')
    parser.add_argument('-o', '--output', required=True)
    args = parser.parse_args()

    rows, warnings = convert(
        parse(args.source, args.encoding), args.vehicle, args.currency, not args.stations,
    )

    # utf-8-sig: the importer decodes with it, and Excel writes the BOM on a round trip.
    with open(args.output, 'w', encoding='utf-8-sig', newline='') as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow({column: row.get(column, '') for column in COLUMNS})

    litres = sum(float(row['fuel_liters']) for row in rows)
    total = sum(float(row['amount']) for row in rows)
    print(f'{len(rows)} fuelings -> {args.output}')
    print(f'{rows[0]["occurred_at"]} to {rows[-1]["occurred_at"]}, {litres:,.2f} L, {total:,.0f} {args.currency}')
    for warning in warnings:
        print(f'  check: {warning}', file=sys.stderr)


if __name__ == '__main__':
    main()
