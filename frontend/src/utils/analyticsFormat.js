/**
 * The shaping rules behind the Analytics page.
 *
 * Pulled out of the component because the PDF report renders the same figures and
 * must reach them the same way — a column list or a metric that only existed inside
 * Analytics.jsx would have been copied into the export and quietly drifted from it.
 * Nothing here renders; the export decides its own colours, which is why the two
 * helpers that need them take colours as arguments rather than a theme.
 */

// The trend arrives bucketed by the range: 30 days as days, 90 as weeks, longer as
// months. The backend sends every bucket as the ISO date it starts on, so parse once
// and let the bucket decide how much of it to show.
export const parsePeriod = (value) => {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

// Axis ticks stay terse — a bare month repeated across two years is ambiguous, so the
// year is added on the first tick and whenever a new one starts.
export const buildTickLabel = (bucket) => (value, index) => {
  const dt = parsePeriod(value);
  if (!dt) return '';
  if (bucket === 'month') {
    const month = dt.toLocaleDateString(undefined, { month: 'short' });
    // The year is apostrophised rather than run together: a plain "Jul 25" is exactly
    // how a day tick renders July 25th, and the two buckets must not look alike.
    const startsYear = index === 0 || dt.getMonth() === 0;
    return startsYear ? `${month} '${String(dt.getFullYear()).slice(-2)}` : month;
  }
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

// The tooltip has room to be unambiguous, and a week needs saying which week. The
// report uses the same labels in its tables, where there is just as much room.
export const buildTooltipLabel = (bucket) => (value) => {
  const dt = parsePeriod(value);
  if (!dt) return '';
  if (bucket === 'month') return dt.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const full = dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return bucket === 'week' ? `Week of ${full}` : full;
};

export const BUCKET_NOUN = { day: 'day', week: 'week', month: 'month' };

// Built per render because the labels and formatters follow the account's units.
export const buildColumns = (fmt) => [
  { id: 'name', label: 'Vehicle', numeric: false },
  { id: 'total_cost', label: 'Total cost', numeric: true, format: fmt.money },
  { id: 'session_cost', label: 'Driving', numeric: true, format: fmt.money },
  { id: 'expense_cost', label: 'Other', numeric: true, format: fmt.money },
  { id: 'distance_km', label: 'Distance', numeric: true, format: fmt.distance },
  { id: `Per 100 ${fmt.distanceShort}`, label: `Per 100 ${fmt.distanceShort}`, numeric: true,
    sortKey: 'cost_per_100km',
    format: (v) => (v ? fmt.moneyPerHundred(v) : '—') },
  { id: 'total_energy', label: 'Energy', numeric: true, format: (v) => (v ? fmt.energy(v) : '—') },
];

// Three ways to read "efficient", because they disagree and the disagreement matters:
// a car can be the cheapest to drive while looking expensive overall simply because
// its insurance is. Lower is better for all three.
// compute() always works in the canonical per-100km figure; format() converts it, so
// the ranking order stays identical whichever units are selected.
export const buildMetrics = (fmt) => ({
  running: {
    label: 'Cost to drive',
    note: 'Charging and fuel only — what it costs to actually move the car.',
    compute: (v) => (v.distance_km > 0 ? (Number(v.session_cost || 0) / v.distance_km) * 100 : null),
    format: fmt.moneyPerHundred,
  },
  total: {
    label: 'Total cost',
    note: 'Everything divided by distance — fuel plus insurance, tax, maintenance.',
    compute: (v) => (v.distance_km > 0 ? Number(v.cost_per_100km || 0) : null),
    format: fmt.moneyPerHundred,
  },
  energy: {
    label: 'Energy use',
    note: 'Consumption regardless of price. Only vehicles that charge appear here.',
    compute: (v) => (v.distance_km > 0 && v.total_energy > 0 ? (Number(v.total_energy) / v.distance_km) * 100 : null),
    format: (v) => fmt.energy(v),
  },
});

/**
 * Vehicles on one metric, best first.
 *
 * Vehicles without distance (or without charging, for the energy view) cannot be
 * placed on the scale, so they are dropped rather than shown as zero — the caller
 * counts what is missing from the length difference.
 */
export const rankByMetric = (stats, metric) => (stats || [])
  .map((v) => ({ ...v, value: metric.compute(v) }))
  .filter((v) => v.value !== null && v.value > 0)
  .sort((a, b) => a.value - b.value);

// Five, because that is how many series colours a palette carries — a sixth slice would
// repeat one and put two identical wedges in the same ring. The long tail of one-off
// providers goes into a single slice, which is also all it is worth.
export const PROVIDER_SLICES = 5;

/**
 * Provider rows as pie slices, largest first, by whichever measure the chart is about.
 *
 * Two things never merge into the tail: nothing, and the unnamed bucket — that one is
 * kept separate and greyed, because "I do not know" is not a provider and folding it
 * into "3 more" would quietly claim it was.
 */
export const buildProviderSlices = (rows, key, colors, { tailColor, unnamedColor }) => {
  const withValue = rows.filter((row) => Number(row[key] || 0) > 0);
  const named = withValue.filter((row) => row.provider)
    .sort((a, b) => Number(b[key]) - Number(a[key]));
  const unnamed = withValue.find((row) => !row.provider);

  const slices = named.slice(0, PROVIDER_SLICES).map((row) => ({
    key: row.provider,
    name: row.provider,
    value: Number(row[key]),
    rate: row.avg_cost_per_kwh,
    color: colors.get(row.provider),
  }));

  const tail = named.slice(PROVIDER_SLICES);
  if (tail.length) {
    slices.push({
      key: '__tail',
      name: `${tail.length} more`,
      value: tail.reduce((sum, row) => sum + Number(row[key] || 0), 0),
      color: tailColor,
    });
  }
  if (unnamed) {
    slices.push({
      key: '__unnamed',
      name: 'Unnamed',
      value: Number(unnamed[key]),
      color: unnamedColor,
    });
  }
  return slices;
};
