/**
 * The exported version of Analytics.
 *
 * The page is built for a pointer: half its numbers live in tooltips, and a tooltip
 * does not survive being exported. So this is a second rendering of the same data with
 * every hidden figure made explicit — values written onto the bars themselves, and a
 * table under each chart carrying exactly what its tooltip would have said. Nothing is
 * recomputed here that the page computes for itself; the shared helpers in
 * utils/analyticsFormat.js are the single source for both.
 *
 * It renders into a portal on document.body, parked off-screen rather than hidden:
 * utils/pdfExport.js rasterises it block by block, and an element with no layout
 * rasterises empty. That is also why the charts carry fixed pixel sizes rather than a
 * ResponsiveContainer — the page is A4, so the width is known in advance and does not
 * depend on the window.
 *
 * Colours follow the account: utils/reportTheme.js resolves the same palette and the
 * same light/dark mode the app is in, and the PDF carries the same washed background
 * the page does. That is only possible because the file is generated rather than sent
 * through the browser's print dialog, which would have put a dark card on white paper.
 *
 * Every block the exporter can page-break between carries `data-pdf-block`, and a
 * block is placed whole rather than split. `fixed` holds a block in document order —
 * the header, the summary and the cost-over-time pair; `flow` lets the exporter move
 * it to whichever page it fills best, which is why the sections below the trend are
 * written to stand on their own. `last` is the footer, which is placed after
 * everything else wherever there is room.
 */
import React from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';
import { buildReportTheme, reportCssVars } from '../utils/reportTheme';
import { formatCategoryLabel } from '../utils/expenseCategories';
import { StackTopBar } from '../utils/chartShapes';
import {
  BUCKET_NOUN,
  buildColumns,
  buildProviderSlices,
  buildTickLabel,
  buildTooltipLabel,
} from '../utils/analyticsFormat';

// A4 portrait less the 10 mm side margins the exporter uses, at 96 dpi. Charts are
// drawn at this width and scaled once, uniformly, onto the page — so the label sizes
// below keep their proportions in the file.
//
// A chart sits inside a card, so it gets the report width less that card's padding
// and border. Drawn at the full width it overflowed by exactly the padding, and the
// rasteriser cut the last column off at the card's edge.
//
// The rings are drawn well inside their box because their share labels sit outside
// the ring and an SVG clips at its own edge — at a radius that filled the box, "67%"
// lost its top row of pixels and "12%" printed as "1".
const REPORT_W = 700;
const CARD_PAD = 14;
const CHART_W = REPORT_W - (CARD_PAD + 1) * 2;
const TREND_H = 300;
const DRILLDOWN_H = 240;
const PIE_SIZE = 170;

/**
 * A segment is only labelled when there is room for the label to sit inside it.
 *
 * The share is measured against the tallest column rather than each column's own
 * total, because what a label needs is absolute height on the page — a slim month
 * whose spend happens to be all fuel still has nowhere to put the number.
 *
 * Values are rounded to the whole unit first: a year view is fourteen columns across
 * 600px, and "$403.7" against its neighbour's "$431.7" leaves them touching, where
 * "$404" and "$432" do not.
 */
const segmentLabel = (max, format) => (value) => {
  const v = Number(value || 0);
  if (!v || v < max * 0.11) return '';
  return format(Math.round(v));
};

/**
 * The stack total, written above the column.
 *
 * Recharts hands a LabelList formatter one series' value, so the total has to be
 * recomputed from the row — which is why this is a content element rather than a
 * formatter. It hangs off the topmost bar in the stack, whose `y` is the top of the
 * whole column even on rows where that series happens to be zero.
 */
const StackTotalLabel = ({ x, y, width, index, rows = [], keys = [], format, fill }) => {
  const row = rows[index];
  if (!row) return null;
  const total = keys.reduce((sum, key) => sum + Number(row[key] || 0), 0);
  if (!total) return null;
  return (
    <text x={Number(x) + Number(width) / 2} y={Number(y) - 5} textAnchor="middle"
      fontSize={10} fontWeight={700} fill={fill}>
      {format(Math.round(total))}
    </text>
  );
};

const pieShare = ({ percent }) => (percent >= 0.05 ? `${Math.round(percent * 100)}%` : '');

const Figure = ({ label, value, hint, color }) => (
  <div className="pr-figure" style={{ borderLeftColor: color }}>
    <span className="pr-figure-label">{label}</span>
    <strong className="pr-figure-value">{value}</strong>
    {hint ? <span className="pr-figure-hint">{hint}</span> : null}
  </div>
);

/**
 * `fixed` opts a section out of the exporter's packing pass: it keeps its place in
 * the document order instead of being moved to whichever page it fills best. The
 * opening of the report is an argument — what everything cost, then how that ran over
 * time — and a reader who has to hunt for the summary has lost more than the packer
 * saved. Everything after it is reference material and can land anywhere.
 */
const Section = ({ title, note, children, fixed }) => (
  <section className="pr-section" data-pdf-block={fixed ? 'fixed' : 'flow'}>
    <h2 className="pr-h2">{title}</h2>
    {note ? <p className="pr-note">{note}</p> : null}
    {children}
  </section>
);

const Swatch = ({ color }) => <span className="pr-swatch" style={{ backgroundColor: color }} />;

/**
 * One provider ring beside the table of its exact figures.
 *
 * The ring only carries percentages — provider names run to "MOL Plugee" and will not
 * fit in a one-record slice — so the table is where the reader gets the numbers the
 * screen puts in a tooltip. The heading is the section's, not this component's: each
 * ring is its own section now.
 */
const ProviderBlock = ({ slices, valueHeader, formatValue, formatRate, empty, theme }) => {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
  if (!slices.length) return <p className="pr-note">{empty}</p>;
  return (
    <div className="pr-pie-row">
      <PieChart width={PIE_SIZE} height={PIE_SIZE}>
        <Pie data={slices} dataKey="value" nameKey="name" cx="50%" cy="50%"
          innerRadius={34} outerRadius={54} paddingAngle={3} stroke={theme.cardSolid} strokeWidth={2}
          isAnimationActive={false} labelLine={false} label={pieShare}
          fontSize={10} fill={theme.ink}>
          {slices.map((slice) => <Cell key={slice.key} fill={slice.color} />)}
        </Pie>
      </PieChart>
      <table className="pr-table">
        <thead>
          <tr>
            <th>Provider</th>
            <th className="pr-num">{valueHeader}</th>
            <th className="pr-num">Share</th>
            {formatRate ? <th className="pr-num">Avg rate</th> : null}
          </tr>
        </thead>
        <tbody>
          {slices.map((slice) => (
            <tr key={slice.key}>
              <td><Swatch color={slice.color} />{slice.name}</td>
              <td className="pr-num">{formatValue(slice.value)}</td>
              <td className="pr-num">{Math.round((slice.value / total) * 100)}%</td>
              {formatRate ? (
                <td className="pr-num">{slice.rate != null ? formatRate(slice.rate) : '—'}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const AnalyticsReport = ({
  data,
  chartData,
  forecast,
  drilldown,
  projectionOn,
  comparison,
  rangeLabel,
  trendBucket,
  drilldownBucket,
  sections,
  fmt,
  user,
  mode,
  ref,
}) => {
  // Which blocks the export dialog left in. Undefined means every one of them, so a
  // caller that does not care about the picker keeps the whole report.
  const shows = (id) => !sections || sections.includes(id);

  const theme = buildReportTheme(user?.theme_palette, mode);
  const { brand, series, ink, inkMuted, onFill } = theme;
  const huf = fmt.money;
  const compact = fmt.numberCompact;

  const summary = data.summary || {};
  const stats = data.vehicle_stats || [];
  const categories = data.expense_categories || [];
  const categoryTotal = categories.reduce((sum, c) => sum + Number(c.total_amount || 0), 0) || 1;
  const providers = data.providers || [];
  const columns = buildColumns(fmt);

  const tickLabel = buildTickLabel(trendBucket);
  const periodLabel = buildTooltipLabel(trendBucket);
  const drilldownPeriodLabel = buildTooltipLabel(drilldownBucket);
  const drilldownTick = buildTickLabel(drilldownBucket);

  const providerColors = new Map(
    providers.filter((p) => p.provider).map((p, index) => [p.provider, series[index % series.length]]),
  );
  const sliceColors = { tailColor: theme.tail, unnamedColor: theme.unnamed };
  const stopsSlices = buildProviderSlices(providers, 'record_count', providerColors, sliceColors);
  const energySlices = buildProviderSlices(providers, 'energy_kwh', providerColors, sliceColors);

  // The scale the in-bar labels are judged against: a segment worth a twentieth of the
  // tallest column has no room to hold its own number.
  const trendMax = chartData.reduce((max, row) => Math.max(
    max,
    Number(row.session_cost || 0) + Number(row.expense_cost || 0)
      + Number(row.projected_session_cost || 0) + Number(row.projected_expense_cost || 0),
  ), 0);
  const trendKeys = ['session_cost', 'expense_cost', 'projected_session_cost', 'projected_expense_cost'];
  const barLabel = segmentLabel(trendMax, fmt.moneyCompact);

  const drilldownRows = drilldown?.trend || [];
  const drilldownMax = drilldownRows.reduce(
    (max, row) => Math.max(max, Number(row.session_cost || 0) + Number(row.expense_cost || 0)), 0,
  );
  const drilldownLabel = segmentLabel(drilldownMax, fmt.moneyCompact);

  const generated = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });

  return (
    <div className="pdf-report" role="document" aria-hidden="true" ref={ref} style={reportCssVars(theme)}>
      <header className="pr-header" data-pdf-block="fixed">
        <div>
          <h1 className="pr-h1">Analytics report</h1>
          <p className="pr-note">
            {rangeLabel ? `Range: ${rangeLabel}. ` : ''}Amounts in {fmt.currency}, distance in {fmt.distanceShort}.
          </p>
        </div>
        <div className="pr-generated">
          <span>Mileage</span>
          <span>{generated}</span>
        </div>
      </header>

      {shows('summary') ? (
      <Section title="Summary" fixed>
        <div className="pr-figures">
          <Figure label="Total cost" value={huf(summary.total_operating_cost)} hint={rangeLabel}
            color={brand.secondary} />
          <Figure label="Distance" value={fmt.distance(summary.total_distance_km)}
            hint={`${stats.length} vehicle${stats.length === 1 ? '' : 's'}`} color={brand.primary} />
          <Figure label={`Cost per 100 ${fmt.distanceShort}`} value={huf(summary.avg_cost_per_100km)}
            hint="across the fleet" color={brand.warning} />
          <Figure label="Cost per kWh" value={huf(data.avg_cost_per_kwh)}
            hint={`${Math.round(summary.total_energy_kwh || 0).toLocaleString()} kWh charged`}
            color={brand.success} />
        </div>
        {forecast?.available ? (
          <p className="pr-note">
            Projected to 31 December: <strong>≈ {huf(forecast.summary.remaining_cost)}</strong> over the
            next {forecast.summary.months_ahead} month{forecast.summary.months_ahead === 1 ? '' : 's'} —
            an estimate from {forecast.basis.history_days} days of history
            {forecast.basis.confidence === 'high' ? '' : ` (${forecast.basis.confidence} confidence)`},
            not recorded spend.
          </p>
        ) : null}
      </Section>
      ) : null}

      {shows('trendChart') ? (
      <Section
        fixed
        title="Cost over time"
        note={`Bars are spend, the line is cost per 100 ${fmt.distanceShort}. Figures above each column are the total for that period.`}
      >
        <ComposedChart width={CHART_W} height={TREND_H} data={chartData} margin={{ top: 22, left: 4, right: 8 }}>
          {/* The same hatch the screen uses, so an estimated column reads as one here
              too — colour alone would not carry it for a reader who prints the file
              on a greyscale printer. The gaps are the card's own solid colour rather
              than transparent: the background wash showing through a bar would read
              as part of the data. */}
          <defs>
            <pattern id="pr-projectedDriving" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="7" height="7" fill={theme.cardSolid} />
              <line x1="0" y1="0" x2="0" y2="7" stroke={brand.primary} strokeWidth="2.5" />
            </pattern>
            <pattern id="pr-projectedOther" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="7" height="7" fill={theme.cardSolid} />
              <line x1="0" y1="0" x2="0" y2="7" stroke={brand.secondary} strokeWidth="2.5" />
            </pattern>
          </defs>
          <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.rule} />
          {/* Every column labelled while they fit — the paper is fixed, so this can be
              decided from the count rather than measured. A daily range runs to thirty
              buckets, where a tick per column would print as a grey smear; the table
              below names every period regardless. */}
          <XAxis dataKey="period" tickFormatter={tickLabel} axisLine={false} tickLine={false}
            interval={chartData.length > 16 ? 'preserveStartEnd' : 0} minTickGap={12}
            tick={{ fill: inkMuted, fontSize: 10 }} />
          <YAxis yAxisId="cost" tickFormatter={compact} axisLine={false} tickLine={false} width={46}
            tick={{ fill: inkMuted, fontSize: 10 }} />
          <YAxis yAxisId="eff" orientation="right" tickFormatter={compact} axisLine={false} tickLine={false}
            width={46} tick={{ fill: inkMuted, fontSize: 10 }} />
          <Bar yAxisId="cost" dataKey="session_cost" stackId="cost" fill={brand.primary}
            shape={<StackTopBar above={['expense_cost', 'projected_session_cost', 'projected_expense_cost']} />}
            isAnimationActive={false}>
            <LabelList dataKey="session_cost" position="center" formatter={barLabel}
              fill={onFill} fontSize={9} fontWeight={700} />
          </Bar>
          <Bar yAxisId="cost" dataKey="expense_cost" stackId="cost" fill={brand.secondary}
            shape={<StackTopBar above={['projected_session_cost', 'projected_expense_cost']} />}
            isAnimationActive={false}>
            <LabelList dataKey="expense_cost" position="center" formatter={barLabel}
              fill={onFill} fontSize={9} fontWeight={700} />
            {/* The total rides on whichever series is topmost, which is this one until
                a projection is stacked over it. */}
            {!projectionOn ? (
              <LabelList content={<StackTotalLabel rows={chartData} keys={trendKeys} format={fmt.moneyCompact} fill={ink} />} />
            ) : null}
          </Bar>
          {projectionOn ? (
            <Bar yAxisId="cost" dataKey="projected_session_cost" stackId="cost"
              fill="url(#pr-projectedDriving)" stroke={brand.primary} strokeDasharray="4 3"
              shape={<StackTopBar above={['projected_expense_cost']} />} isAnimationActive={false}>
              <LabelList dataKey="projected_session_cost" position="center" formatter={barLabel}
                fill={ink} fontSize={9} fontWeight={700} />
            </Bar>
          ) : null}
          {projectionOn ? (
            <Bar yAxisId="cost" dataKey="projected_expense_cost" stackId="cost"
              fill="url(#pr-projectedOther)" stroke={brand.secondary} strokeDasharray="4 3"
              shape={<StackTopBar />} isAnimationActive={false}>
              <LabelList dataKey="projected_expense_cost" position="center" formatter={barLabel}
                fill={ink} fontSize={9} fontWeight={700} />
              <LabelList content={<StackTotalLabel rows={chartData} keys={trendKeys} format={fmt.moneyCompact} fill={ink} />} />
            </Bar>
          ) : null}
          <Line yAxisId="eff" type="monotone" dataKey="avg_cost_per_100km" stroke={brand.warning}
            strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
          {comparison?.applies ? (
            <Line yAxisId="cost" type="monotone" dataKey="petrol_equivalent_cost" stroke={series[4]}
              strokeWidth={2} strokeDasharray="7 4" dot={false} connectNulls={false} isAnimationActive={false} />
          ) : null}
        </ComposedChart>

        <p className="pr-legend">
          <span><Swatch color={brand.primary} />Driving spend</span>
          <span><Swatch color={brand.secondary} />Other costs</span>
          {projectionOn ? <span><Swatch color={theme.tail} />Hatched: projected, not recorded</span> : null}
          <span><Swatch color={brand.warning} />Cost per 100 {fmt.distanceShort}</span>
          {comparison?.applies ? <span><Swatch color={series[4]} />Same distance on petrol</span> : null}
        </p>

      </Section>
      ) : null}

      {/* The tooltip, unrolled — and a card of its own, because a chart and a table of
          every period together are taller than a page can hold beside anything else,
          which left the summary sharing a page with nothing but white. */}
      {shows('trendTable') ? (
      <Section fixed title={`Cost over time — every ${BUCKET_NOUN[trendBucket] || 'month'}`}>
        <table className="pr-table pr-table-full">
          <thead>
            <tr>
              <th>Period</th>
              <th className="pr-num">Driving</th>
              <th className="pr-num">Other</th>
              {projectionOn ? <th className="pr-num">Projected</th> : null}
              <th className="pr-num">Total</th>
              <th className="pr-num">Per 100 {fmt.distanceShort}</th>
              {comparison?.applies ? <th className="pr-num">On petrol</th> : null}
            </tr>
          </thead>
          <tbody>
            {chartData.map((row) => {
              const projected = Number(row.projected_session_cost || 0) + Number(row.projected_expense_cost || 0);
              const recorded = Number(row.session_cost || 0) + Number(row.expense_cost || 0);
              return (
                <tr key={row.period}>
                  <td>{periodLabel(row.period)}</td>
                  <td className="pr-num">{huf(row.session_cost)}</td>
                  <td className="pr-num">{huf(row.expense_cost)}</td>
                  {projectionOn ? (
                    <td className="pr-num pr-estimate">{projected ? `≈ ${huf(projected)}` : '—'}</td>
                  ) : null}
                  <td className="pr-num"><strong>{huf(recorded + projected)}</strong></td>
                  <td className="pr-num">
                    {row.avg_cost_per_100km != null ? fmt.moneyPerHundred(row.avg_cost_per_100km) : '—'}
                  </td>
                  {comparison?.applies ? (
                    <td className="pr-num">
                      {row.petrol_equivalent_cost != null ? huf(row.petrol_equivalent_cost) : '—'}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {comparison?.applies ? (
          <p className="pr-note">
            Petrol column assumes {fmt.toConsumptionInput(comparison.consumption_l_100km)} {fmt.consumptionLabel}
            {' at '}{fmt.fuelPrice(comparison.fuel_price_per_litre)} {fmt.fuelPriceLabel}
            {comparison.fuel_price_source === 'observed'
              ? `, averaged from your own ${comparison.observed_fill_ups} fill-up${comparison.observed_fill_ups === 1 ? '' : 's'}`
              : ''}
            . Fuel only — it excludes insurance, tax and servicing on both sides.
          </p>
        ) : null}
      </Section>
      ) : null}

      {/* The rings come before the all-figures table rather than after it. The three
          efficiency leaderboards used to sit here — every metric written out, since a
          PDF reader cannot flip the page's toggle — but they said what the table below
          already says, one row per vehicle, and pushed the only two pictures in the
          second half of the report onto a page of their own. */}
      {shows('split') ? (
      <Section title="Where the money goes">
        <table className="pr-table pr-table-full">
          <thead>
            <tr>
              <th>Split</th>
              <th className="pr-num">Amount</th>
              <th className="pr-num">Share</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><Swatch color={brand.primary} />Driving spend — charging and fuel</td>
              <td className="pr-num">{huf(summary.session_cost)}</td>
              <td className="pr-num">{Math.round(summary.session_share_pct || 0)}%</td>
            </tr>
            <tr>
              <td><Swatch color={brand.secondary} />Other costs — insurance, maintenance, tax…</td>
              <td className="pr-num">{huf(summary.expense_cost)}</td>
              <td className="pr-num">{Math.round(summary.expense_share_pct || 0)}%</td>
            </tr>
          </tbody>
        </table>

      </Section>
      ) : null}

      {shows('categories') ? (
      <Section title="Cost categories">
        {categories.length ? (
          <div className="pr-pie-row">
            <PieChart width={PIE_SIZE} height={PIE_SIZE}>
              <Pie data={categories} dataKey="total_amount" nameKey="category" cx="50%" cy="50%"
                innerRadius={34} outerRadius={54} paddingAngle={3} stroke={theme.cardSolid} strokeWidth={2}
                isAnimationActive={false} labelLine={false} label={pieShare} fontSize={10} fill={ink}>
                {categories.map((entry, index) => (
                  <Cell key={entry.category} fill={series[index % series.length]} />
                ))}
              </Pie>
            </PieChart>
            <table className="pr-table">
              <thead>
                <tr>
                  <th>Cost category</th>
                  <th className="pr-num">Amount</th>
                  <th className="pr-num">Share</th>
                  <th className="pr-num">Items</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((entry, index) => (
                  <tr key={entry.category}>
                    <td><Swatch color={series[index % series.length]} />{formatCategoryLabel(entry.category)}</td>
                    <td className="pr-num">{huf(entry.total_amount)}</td>
                    <td className="pr-num">{Math.round((Number(entry.total_amount) / categoryTotal) * 100)}%</td>
                    <td className="pr-num">{entry.item_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pr-note">No costs recorded in this range.</p>
        )}
      </Section>
      ) : null}

      {/* One ring per section rather than both in one. Every section is a unit of
          pagination, so a section is also the size of hole the packer can fill: two
          rings in one card is 110 mm that has to land somewhere whole, and the page
          it did not fit on kept the gap. */}
      {providers.length && shows('providerStops') ? (
        <Section title="Providers — stops" note="How often you stop where.">
          <ProviderBlock slices={stopsSlices} valueHeader="Records"
            formatValue={(value) => `${value}`} empty="No charging or fuel records in this range."
            theme={theme} />
        </Section>
      ) : null}

      {providers.length && shows('providerEnergy') ? (
        <Section title="Providers — energy" note="And how much energy you take there.">
          <ProviderBlock slices={energySlices} valueHeader="Energy"
            formatValue={fmt.energy} formatRate={(rate) => `${huf(rate)} / kWh`}
            empty="No charging with a recorded kWh figure in this range." theme={theme} />
        </Section>
      ) : null}

      {shows('vehicleTable') ? (
      <Section title="All figures">
        <table className="pr-table pr-table-full">
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.id} className={col.numeric ? 'pr-num' : undefined}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stats.map((vehicle) => (
              <tr key={vehicle.id}>
                {columns.map((col) => {
                  const field = col.sortKey || col.id;
                  return (
                    <td key={col.id} className={col.numeric ? 'pr-num' : undefined}>
                      {/* A sold car only reaches this table when it was asked for by
                          name, and its figures cover the part of the range it was still
                          owned for — so the row has to say so, or a part-year total
                          reads as a full one. */}
                      {field === 'name'
                        ? `${vehicle.name} (${vehicle.fuel_type})${vehicle.is_archived ? ' — sold' : ''}`
                        : col.format(Number(vehicle[field] || 0))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      ) : null}

      {drilldown ? (
        <Section title={`Single vehicle — ${drilldown.vehicle?.name || ''}`}
          note="Same range, one vehicle.">
          <div className="pr-figures">
            <Figure label="Total cost" value={huf(drilldown.summary?.total_cost)} color={brand.secondary} />
            <Figure label="Distance" value={fmt.distance(drilldown.summary?.distance_km)} color={brand.primary} />
            <Figure label={`Per 100 ${fmt.distanceShort}`} value={huf(drilldown.summary?.avg_cost_per_100km)}
              color={brand.warning} />
            <Figure label="Records" value={String(drilldown.summary?.total_records || 0)} color={brand.success} />
          </div>
          <ComposedChart width={CHART_W} height={DRILLDOWN_H} data={drilldownRows} margin={{ top: 22, left: 4, right: 8 }}>
            <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.rule} />
            <XAxis dataKey="period" tickFormatter={drilldownTick} axisLine={false} tickLine={false}
              interval={drilldownRows.length > 16 ? 'preserveStartEnd' : 0} minTickGap={12}
              tick={{ fill: inkMuted, fontSize: 10 }} />
            <YAxis tickFormatter={compact} axisLine={false} tickLine={false} width={46}
              tick={{ fill: inkMuted, fontSize: 10 }} />
            <Bar dataKey="session_cost" stackId="cost" fill={brand.primary}
              shape={<StackTopBar above={['expense_cost']} />} isAnimationActive={false}>
              <LabelList dataKey="session_cost" position="center" formatter={drilldownLabel}
                fill={onFill} fontSize={9} fontWeight={700} />
            </Bar>
            <Bar dataKey="expense_cost" stackId="cost" fill={brand.secondary}
              shape={<StackTopBar />} isAnimationActive={false}>
              <LabelList dataKey="expense_cost" position="center" formatter={drilldownLabel}
                fill={onFill} fontSize={9} fontWeight={700} />
              <LabelList content={(
                <StackTotalLabel rows={drilldownRows} keys={['session_cost', 'expense_cost']}
                  format={fmt.moneyCompact} fill={ink} />
              )} />
            </Bar>
          </ComposedChart>
        </Section>
      ) : null}

      {drilldown ? (
        <Section title={`${drilldown.vehicle?.name || 'Vehicle'} — every ${BUCKET_NOUN[drilldownBucket] || 'month'}`}>
          <table className="pr-table pr-table-full">
            <thead>
              <tr>
                <th>Period</th>
                <th className="pr-num">Driving</th>
                <th className="pr-num">Other</th>
                <th className="pr-num">Total</th>
              </tr>
            </thead>
            <tbody>
              {drilldownRows.map((row) => (
                <tr key={row.period}>
                  <td>{drilldownPeriodLabel(row.period)}</td>
                  <td className="pr-num">{huf(row.session_cost)}</td>
                  <td className="pr-num">{huf(row.expense_cost)}</td>
                  <td className="pr-num">
                    <strong>{huf(Number(row.session_cost || 0) + Number(row.expense_cost || 0))}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      ) : null}

      <footer className="pr-footer" data-pdf-block="last">
        Generated by Mileage · {generated} · Amounts are as entered; the currency is a label, not a conversion.
      </footer>
    </div>
  );
};

export default AnalyticsReport;
