import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  LinearProgress,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useDelayedLoading } from '../utils/useDelayedLoading';
import { getChartColors, getSeriesColor } from '../utils/chartColors';
import { StackTopBar } from '../utils/chartShapes';
import { formatCategoryLabel } from '../utils/expenseCategories';
import {
  BUCKET_NOUN,
  buildColumns,
  buildMetrics,
  buildProviderSlices,
  buildTickLabel,
  buildTooltipLabel,
  buildTrendRows,
  rankByMetric,
} from '../utils/analyticsFormat';
import AnalyticsReport from './AnalyticsReport';
import ExportOptionsDialog from './ExportOptionsDialog';
import { useAuth } from '../context/useAuth';
import { createFormatters } from '../utils/units';
import { buildReportTheme } from '../utils/reportTheme';
import { exportReportToPdf, reportFileName } from '../utils/pdfExport';
import { pluralize } from '../utils/plural';
import { AnalyticsSkeleton } from './SectionSkeletons';

const RANGES = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'ytd', label: 'Year' },
  { value: 'all', label: 'All' },
];

/**
 * One provider ring with its own legend.
 *
 * The legend is a list beside the ring rather than slice labels: provider names run to
 * "MOL Plugee" and a one-record slice has no room to write it inside.
 */
const ProviderPie = ({ title, slices, formatValue, formatRate, empty, chartAnimation, tooltipStyle, itemStyle, theme }) => {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{title}</Typography>
      {slices.length === 0 ? (
        <Typography variant="body2" color="text.secondary">{empty || 'Nothing in this range.'}</Typography>
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
          <Box sx={{ width: 168, height: 168, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={slices} dataKey="value" nameKey="name"
                  cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={3}
                  stroke={theme.palette.background.paper} strokeWidth={3}
                  isAnimationActive={chartAnimation}>
                  {slices.map((slice) => <Cell key={slice.key} fill={slice.color} />)}
                </Pie>
                <Tooltip
                  contentStyle={tooltipStyle}
                  itemStyle={itemStyle}
                  formatter={(value, name, entry) => {
                    const rate = formatRate && entry?.payload?.rate != null
                      ? ` · ${formatRate(entry.payload.rate)}`
                      : '';
                    return [`${formatValue(value)}${rate}`, name];
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </Box>
          <Stack spacing={0.75} sx={{ flex: 1, width: '100%' }}>
            {slices.map((slice) => (
              <Stack key={slice.key} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, backgroundColor: slice.color }} />
                  <Typography variant="body2" noWrap
                    color={slice.key.startsWith('__') ? 'text.secondary' : 'text.primary'}>
                    {slice.name}
                  </Typography>
                </Stack>
                <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                  {Math.round((slice.value / (total || 1)) * 100)}%
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
      )}
    </Box>
  );
};

const Figure = ({ label, value, hint, color }) => (
  <Box sx={{ borderLeft: `3px solid ${color}`, pl: 1.5 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="h6" component="div" fontWeight={700}>{value}</Typography>
    {hint ? <Typography variant="caption" color="text.secondary">{hint}</Typography> : null}
  </Box>
);

/**
 * The "why" behind the dashboard's headline.
 *
 * The dashboard answers how this month is going; this page exists to compare and
 * explain, which is why everything here obeys the range selector. It used to render
 * vehicle_stats five separate times — two bar charts plus three leaderboards over the
 * same array — so the comparison is now a single sortable table.
 */
const Analytics = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const chartAnimation = !useMediaQuery('(prefers-reduced-motion: reduce)');
  const isLight = theme.palette.mode === 'light';
  const COLORS = getChartColors(theme);
  const { user } = useAuth();
  const fmt = useMemo(() => createFormatters(user), [user]);
  const huf = fmt.money;
  const km = fmt.distance;
  const compact = fmt.numberCompact;   // tengelyekre: penznem nelkul

  const [range, setRange] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // Skip the placeholder entirely when the data beats the delay.
  const showSkeleton = useDelayedLoading(loading);
  // Switching range should not blank the page: keep the previous numbers on screen and
  // dim them slightly while the new ones arrive. Only the very first load shows the
  // skeleton, because there is nothing to keep.
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [orderBy, setOrderBy] = useState('total_cost');
  const [order, setOrder] = useState('desc');
  const [metricKey, setMetricKey] = useState('running');
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [drilldown, setDrilldown] = useState(null);
  const [forecast, setForecast] = useState(null);
  // The report is only mounted while an export is running. It is a second
  // rendering of everything on this page, charts included, and there is no reason to
  // pay for it on every visit for the sake of a button most sessions never press.
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // What the report is rendering: its own copy of the data, because the export can
  // cover a subset of the fleet while the page keeps showing all of it. Non-null only
  // while a file is being built.
  const [reportPayload, setReportPayload] = useState(null);
  // The element the exporter rasterises, handed back by the report itself.
  const reportRef = useRef(null);

  // The server decides the bucket from the range; read it back rather than deriving it
  // here, so the axis can never disagree with the data it is labelling. Falls back to
  // months for the first render, before any response has arrived.
  const trendBucket = data?.trend_bucket || 'month';
  // What the server actually used for the petrol line — which figures, and whether they
  // came from the account's own fill-ups or from what it configured.
  const comparison = data?.fuel_comparison || null;
  const trendTick = useMemo(() => buildTickLabel(trendBucket), [trendBucket]);
  const trendTooltipLabel = useMemo(() => buildTooltipLabel(trendBucket), [trendBucket]);
  const trendNoun = BUCKET_NOUN[trendBucket] || 'month';

  const drilldownBucket = drilldown?.trend_bucket || trendBucket;
  const drilldownTick = useMemo(() => buildTickLabel(drilldownBucket), [drilldownBucket]);
  const drilldownTooltipLabel = useMemo(() => buildTooltipLabel(drilldownBucket), [drilldownBucket]);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await apiFetch(`/api/analytics/summary?range=${range}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || 'Analytics is unavailable right now');
      }
      setData(await res.json());
      setErrorMessage('');
    } catch (error) {
      setData(null);
      setErrorMessage(error.message);
      toast.error(error.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  // Independent of the range: the projection always runs to the end of the calendar
  // year, so it never needs refetching when the range changes. Failure is silent — an
  // estimate is not worth an error toast on a page whose real numbers still loaded.
  useEffect(() => {
    let active = true;
    apiFetch('/api/analytics/forecast')
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => { if (active && payload) setForecast(payload); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Default the drilldown to whichever vehicle leads the current sort.
  useEffect(() => {
    const stats = data?.vehicle_stats || [];
    if (!stats.length) { setSelectedVehicleId(''); return; }
    if (!stats.some((v) => String(v.id) === String(selectedVehicleId))) {
      setSelectedVehicleId(String(stats[0].id));
    }
  }, [data, selectedVehicleId]);

  useEffect(() => {
    if (!selectedVehicleId) { setDrilldown(null); return; }
    apiFetch(`/api/analytics/vehicles/${selectedVehicleId}?range=${range}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(setDrilldown)
      .catch(() => setDrilldown(null));
  }, [selectedVehicleId, range]);

  const sortedVehicles = useMemo(() => {
    const rows = [...(data?.vehicle_stats || [])];
    return rows.sort((a, b) => {
      const av = a[orderBy] ?? 0;
      const bv = b[orderBy] ?? 0;
      const cmp = typeof av === 'string' ? av.localeCompare(String(bv)) : Number(av) - Number(bv);
      return order === 'asc' ? cmp : -cmp;
    });
  }, [data, orderBy, order]);

  const COLUMNS = useMemo(() => buildColumns(fmt), [fmt]);
  const METRICS = useMemo(() => buildMetrics(fmt), [fmt]);
  const metric = METRICS[metricKey];
  const hasEnergyData = (data?.vehicle_stats || []).some(
    (v) => v.distance_km > 0 && Number(v.total_energy || 0) > 0,
  );

  // Vehicles without distance (or without charging, for the energy view) cannot be
  // placed on this scale, so they are counted out rather than shown as zero.
  const ranked = useMemo(() => rankByMetric(data?.vehicle_stats, metric), [data, metric]);

  const excludedCount = (data?.vehicle_stats || []).length - ranked.length;

  // Declared after hasEnergyData on purpose: the dependency array is evaluated during
  // render, so referencing it earlier hits the temporal dead zone and throws.
  useEffect(() => {
    if (metricKey === 'energy' && !hasEnergyData) setMetricKey('running');
  }, [metricKey, hasEnergyData]);

  // The projection only makes sense against monthly buckets: it is produced per month
  // to the end of the year, and pasting months next to daily or weekly bars would put
  // two different time scales on one axis.
  const projectionOn = trendBucket === 'month' && Boolean(forecast?.available) && (forecast?.months?.length > 0);

  const chartData = useMemo(
    () => buildTrendRows(data?.trend, forecast, projectionOn),
    [data, forecast, projectionOn],
  );

  /**
   * Turn the export dialog's answers into the report's own data, then mount it.
   *
   * A subset of the fleet means the page's numbers are the wrong ones: every total,
   * the trend, the categories and the provider rings are all fleet-wide aggregates,
   * and there is no way to re-cut them client-side. So the selection goes back to the
   * server and the report renders that response instead — the page itself is left
   * alone, since the export is not a change of view.
   */
  const handleExportConfirm = useCallback(async (config) => {
    setExportOpen(false);
    setExporting(true);
    try {
      let reportData = data;
      if (config.vehicleIds) {
        const query = config.vehicleIds.map((id) => `vehicles=${id}`).join('&');
        const res = await apiFetch(`/api/analytics/summary?range=${range}&${query}`);
        if (!res.ok) throw new Error('Could not read the figures for those vehicles.');
        reportData = await res.json();
      }

      const bucket = reportData.trend_bucket || 'month';
      // Same rule the page applies: months only, because the forecast is monthly and
      // pasting months next to daily bars would put two time scales on one axis.
      const reportProjection = config.projection
        && bucket === 'month'
        && Boolean(forecast?.available)
        && (forecast?.months?.length > 0);

      // The drilldown is one vehicle's card. It goes only if it was asked for and the
      // vehicle it describes is inside the selection.
      const drilldownWanted = config.sections.includes('drilldown')
        && drilldown
        && (!config.vehicleIds || config.vehicleIds.includes(Number(drilldown.vehicle?.id)));

      setReportPayload({
        data: reportData,
        chartData: buildTrendRows(reportData.trend, forecast, reportProjection),
        projectionOn: reportProjection,
        drilldown: drilldownWanted ? drilldown : null,
        sections: config.sections,
        bucket,
      });
    } catch (error) {
      toast.error(error.message || 'Could not build the PDF.');
      setExporting(false);
    }
  }, [data, drilldown, forecast, range]);

  /**
   * Write the report out as a PDF.
   *
   * This was `window.print()` and the browser's own "Save as PDF" — free, and it kept
   * the text selectable, but the file was whatever the dialog happened to be set to
   * and the report had to be light-on-white because a print dialog does not know the
   * account has picked a dark theme. The file is generated now, so it looks the same
   * on every platform and carries the account's own palette and background.
   *
   * The work waits two frames after the mount: the report renders in the same commit
   * as the payload, and rasterising it in that commit would catch the charts before
   * Recharts had laid them out. Fonts are waited on for the same reason — the report
   * measured with a fallback face and drawn with the real one comes out with its
   * headings clipped.
   */
  useEffect(() => {
    if (!reportPayload) return undefined;
    let cancelled = false;

    const run = async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (document.fonts?.ready) await document.fonts.ready;
      if (cancelled || !reportRef.current) return;
      try {
        await exportReportToPdf(
          reportRef.current,
          buildReportTheme(user?.theme_palette, theme.palette.mode),
          reportFileName(RANGES.find((r) => r.value === range)?.label),
        );
      } catch {
        toast.error('Could not build the PDF. Try again, or narrow the range.');
      } finally {
        if (!cancelled) {
          setReportPayload(null);
          setExporting(false);
        }
      }
    };

    run();
    return () => { cancelled = true; };
  }, [reportPayload, range, theme.palette.mode, user?.theme_palette]);

  const handleSort = (columnId) => {
    if (orderBy === columnId) setOrder(order === 'asc' ? 'desc' : 'asc');
    else { setOrderBy(columnId); setOrder(columnId === 'name' ? 'asc' : 'desc'); }
  };

  const tooltipStyle = {
    borderRadius: 12,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
  };

  // Pie tooltips only. Recharts colours an item's text from the series colour, which a
  // Bar or a Line carries — a Pie does not, and the entry falls back to black: unreadable
  // on the dark panel, and near enough on the light one. Bars and lines keep their own
  // colour here, since it is what ties the row to the mark it came from.
  const tooltipItemStyle = { color: theme.palette.text.primary };

  const rangeSelector = (
    <ToggleButtonGroup exclusive size="small" value={range}
      onChange={(_, next) => next && setRange(next)} aria-label="Time range">
      {RANGES.map((r) => <ToggleButton key={r.value} value={r.value}>{r.label}</ToggleButton>)}
    </ToggleButtonGroup>
  );

  if (showSkeleton) return <AnalyticsSkeleton />;
  if (loading) return null;

  if (!data) {
    return (
      <Box className="section-shell stagger">
        <Typography variant="h4" component="h1" fontWeight="800" sx={{ mb: 0.5 }}>Analytics</Typography>
        <Card sx={{ p: 4, borderRadius: 4, maxWidth: 620, textAlign: 'center', mx: 'auto', mt: 3 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Analytics unavailable</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {errorMessage || 'Add some records and this page fills in.'}
          </Typography>
          <Button variant="contained" onClick={load}>Try again</Button>
        </Card>
      </Box>
    );
  }

  const summary = data.summary || {};
  const categories = data.expense_categories || [];
  const categoryTotal = categories.reduce((sum, c) => sum + Number(c.total_amount || 0), 0) || 1;
  const providers = data.providers || [];
  // One colour per provider, assigned from the record-count order and reused by both
  // charts — the same name must not change colour between them, or the pair reads as
  // two unrelated pictures instead of two views of one.
  const providerColors = new Map(
    providers.filter((p) => p.provider).map((p, index) => [p.provider, getSeriesColor(theme, index)]),
  );
  // The two greys the tail and the unnamed bucket wear. Passed in rather than derived
  // inside the helper, because the PDF export shares the helper and paints on paper.
  const sliceGreys = {
    tailColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.32 : 0.28),
    unnamedColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.16 : 0.14),
  };
  const stopsSlices = buildProviderSlices(providers, 'record_count', providerColors, sliceGreys);
  const energySlices = buildProviderSlices(providers, 'energy_kwh', providerColors, sliceGreys);
  const hasData = (data.vehicle_stats || []).length > 0;
  const rangeLabel = RANGES.find((r) => r.value === range)?.label.toLowerCase();

  return (
    <Box
      className="section-shell stagger"
      sx={{
        // Dim the results but not the header: the range selector lives up there and
        // must stay usable, including for a quick second change mid-request.
        '& > *:not(:first-of-type)': {
          opacity: refreshing ? 0.5 : 1,
          transition: 'opacity 160ms ease-out',
        },
      }}
    >
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight="800" sx={{ mb: 0.5 }}>Analytics</Typography>
          <Typography variant="body1" color="text.secondary">
            Compare vehicles and see where the money actually goes.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {rangeSelector}
          {/* Disabled while a file is being written: a second press would remount the
              report underneath the one being rasterised. */}
          <Button
            variant="outlined"
            size="small"
            startIcon={<PictureAsPdfOutlinedIcon />}
            disabled={!hasData || exporting}
            onClick={() => setExportOpen(true)}
          >
            {exporting ? 'Building PDF…' : 'Export PDF'}
          </Button>
        </Stack>
      </Stack>

      {!hasData ? (
        <Card sx={{ p: 4, borderRadius: 4, textAlign: 'center', maxWidth: 620, mx: 'auto' }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Nothing in this range</Typography>
          <Typography color="text.secondary">Widen the range, or log a few more records.</Typography>
        </Card>
      ) : (
        <>
          {/* Headline figures for the selected range. */}
          <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
              <Figure label="Total cost" value={huf(summary.total_operating_cost)} hint={rangeLabel}
                color={theme.palette.secondary.main} />
              <Figure label="Distance" value={km(summary.total_distance_km)}
                hint={pluralize((data.vehicle_stats || []).length, 'vehicle')} color={theme.palette.primary.main} />
              <Figure label={`Cost per 100 ${fmt.distanceShort}`} value={huf(summary.avg_cost_per_100km)} hint="across the fleet"
                color={theme.palette.warning.main} />
              <Figure label="Cost per kWh" value={huf(data.avg_cost_per_kwh)}
                hint={`${Math.round(summary.total_energy_kwh || 0).toLocaleString()} kWh charged`}
                color={theme.palette.success.main} />
            </Box>
            {forecast?.available ? (
              <>
                <Divider sx={{ my: 2 }} />
                <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
                  <Typography variant="body2" color="text.secondary">Projected to 31 December</Typography>
                  {/* Deliberately not styled like the measured figures above: it is the
                      only number on this card nobody has actually spent. */}
                  <Typography variant="h6" component="span" fontWeight={700} color="text.secondary"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    ≈ {huf(forecast.summary.remaining_cost)}
                  </Typography>
                  <Chip size="small" variant="outlined" label="estimate" sx={{ height: 20 }} />
                  <Typography variant="caption" color="text.disabled">
                    {forecast.summary.months_ahead} month{forecast.summary.months_ahead === 1 ? '' : 's'} ahead
                  </Typography>
                </Box>
              </>
            ) : null}
          </Card>

          {/* Cost over time, with the efficiency line the dashboard does not show. */}
          <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Cost over time</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: projectionOn ? 1.25 : 2 }}>
              {`Bars are spend, the line is cost per 100 ${fmt.distanceShort} — a ${trendNoun} can look expensive simply because you drove more.`}
            </Typography>
            {projectionOn ? (
              <Alert
                severity="info"
                icon={false}
                sx={{
                  mb: 2,
                  py: 0.75,
                  bgcolor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.05 : 0.04),
                  color: 'text.secondary',
                  border: '1px dashed',
                  borderColor: 'divider',
                  '& .MuiAlert-message': { py: 0 },
                }}
              >
                <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.55 }}>
                  <strong>Hatched bars are an estimate</strong>, not recorded spend — projected to 31 December
                  from {forecast.basis.history_days} days of history
                  {forecast.basis.confidence === 'high' ? '' : ` (${forecast.basis.confidence} confidence)`}.
                  Seasonal consumption is modelled, so the winter months are higher: a battery car spends
                  stored energy on cabin heat and warming the pack, where an engine reuses its own waste heat.
                </Typography>
              </Alert>
            ) : null}
            <Box sx={{ width: '100%', height: isMobile ? 240 : 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ left: 4, right: 4 }}>
                  {/* Hatching as well as fading, so the projection reads as an estimate
                      without depending on the colour difference alone.

                      A hatched fill averages towards its background, which on a light
                      card leaves far too little contrast on its own — measured around
                      1.5:1. The outline is what carries the 3:1 a chart element needs,
                      so it is near-opaque in light mode and the hatch is texture on
                      top of that. */}
                  <defs>
                    <pattern id="projectedDriving" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                      <rect width="7" height="7" fill={alpha(theme.palette.primary.main, isLight ? 0.22 : 0.16)} />
                      <line x1="0" y1="0" x2="0" y2="7" stroke={alpha(theme.palette.primary.main, isLight ? 0.75 : 0.55)} strokeWidth="2.5" />
                    </pattern>
                    <pattern id="projectedOther" width="7" height="7" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                      <rect width="7" height="7" fill={alpha(theme.palette.secondary.main, isLight ? 0.22 : 0.16)} />
                      <line x1="0" y1="0" x2="0" y2="7" stroke={alpha(theme.palette.secondary.main, isLight ? 0.75 : 0.55)} strokeWidth="2.5" />
                    </pattern>
                  </defs>
                  <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
                  <XAxis dataKey="period" tickFormatter={trendTick} axisLine={false} tickLine={false}
                    interval="preserveStartEnd" minTickGap={16}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <YAxis yAxisId="cost" tickFormatter={compact} axisLine={false} tickLine={false} width={48}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <YAxis yAxisId="eff" orientation="right" tickFormatter={compact} axisLine={false} tickLine={false} width={48}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={trendTooltipLabel}
                    formatter={(value, name) => [huf(value), name]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
                  {/* Every segment carries the cap and works out whether it is wearing
                      it, so a month without other costs is rounded like the rest. */}
                  <Bar yAxisId="cost" dataKey="session_cost" name="Driving spend" stackId="cost"
                    shape={<StackTopBar above={['expense_cost', 'projected_session_cost', 'projected_expense_cost']} />}
                    fill={theme.palette.primary.main} isAnimationActive={chartAnimation} />
                  <Bar yAxisId="cost" dataKey="expense_cost" name="Other costs" stackId="cost"
                    shape={<StackTopBar above={['projected_session_cost', 'projected_expense_cost']} />}
                    fill={theme.palette.secondary.main} isAnimationActive={chartAnimation} />
                  {/* Two separate conditionals rather than one fragment: Recharts
                      builds its series by walking its direct children and does not
                      descend into a Fragment, which left the projected bars inheriting
                      the first two bars' colour and legend name. */}
                  {projectionOn ? (
                    <Bar yAxisId="cost" dataKey="projected_session_cost" name="Projected driving" stackId="cost"
                      shape={<StackTopBar above={['projected_expense_cost']} />}
                      fill="url(#projectedDriving)" stroke={alpha(theme.palette.primary.main, isLight ? 0.9 : 0.6)} strokeDasharray="4 3"
                      isAnimationActive={chartAnimation} />
                  ) : null}
                  {projectionOn ? (
                    <Bar yAxisId="cost" dataKey="projected_expense_cost" name="Projected other" stackId="cost"
                      shape={<StackTopBar />}
                      fill="url(#projectedOther)" stroke={alpha(theme.palette.secondary.main, isLight ? 0.9 : 0.6)} strokeDasharray="4 3"
                      isAnimationActive={chartAnimation} />
                  ) : null}
                  <Line yAxisId="eff" type="monotone" dataKey="avg_cost_per_100km" name={`Cost per 100 ${fmt.distanceShort}`}
                    stroke={theme.palette.warning.main} strokeWidth={2} dot={false} connectNulls={false}
                    isAnimationActive={chartAnimation} />
                  {/* On the cost axis, not the efficiency one: this is money, and it is
                      meant to be read against the driving-spend bars it sits over.
                      Dashed so it reads as a hypothetical rather than something that
                      happened, and the dash also separates it from the solid cost-per-100
                      line without relying on colour alone.

                      Rendered only when the server had a real fuel price *and* the
                      comparison applies to what is on screen — a range driven entirely
                      on petrol gets no line, because there the hypothetical is the car
                      restating its own fuel bill. The backend omits the key per period
                      rather than sending null, so the line breaks over the months the
                      petrol car drove alone instead of dropping to zero.

                      Violet rather than the amber at series index 3: that one is within
                      a hair of theme.palette.warning.main, which the cost-per-100 line
                      already uses, and two lines on one chart in near-identical colour
                      would leave the dash pattern doing all the work. */}
                  {comparison?.applies ? (
                    <Line yAxisId="cost" type="monotone" dataKey="petrol_equivalent_cost"
                      name="Same distance on petrol"
                      stroke={getSeriesColor(theme, 4)} strokeWidth={2} strokeDasharray="7 4"
                      dot={false} connectNulls={false} isAnimationActive={chartAnimation} />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
            {/* The line is a hypothetical built on two numbers, so it says which ones.
                An unlabelled comparison invites the reader to trust it more than it
                has earned. */}
            {comparison?.applies ? (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                Petrol line assumes {fmt.toConsumptionInput(comparison.consumption_l_100km)} {fmt.consumptionLabel}
                {' at '}{fmt.fuelPrice(comparison.fuel_price_per_litre)} {fmt.fuelPriceLabel}
                {comparison.fuel_price_source === 'observed'
                  ? `, averaged from your own ${comparison.observed_fill_ups} fill-up${comparison.observed_fill_ups === 1 ? '' : 's'}`
                  : ''}
                . Fuel only — it excludes insurance, tax and servicing on both sides.
              </Typography>
            ) : null}
          </Card>

          {/* Which car is cheapest to run, answered directly. */}
          <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between"
              alignItems={{ sm: 'flex-start' }} spacing={2} sx={{ mb: 1 }}>
              <Box>
                <Typography variant="h6" fontWeight={700}>Efficiency</Typography>
                <Typography variant="body2" color="text.secondary">
                  Ranked best first. {metric.note}
                </Typography>
              </Box>
              <ToggleButtonGroup exclusive size="small" value={metricKey}
                onChange={(_, next) => next && setMetricKey(next)} aria-label="Efficiency metric">
                <ToggleButton value="running">Cost to drive</ToggleButton>
                <ToggleButton value="total">Total cost</ToggleButton>
                <ToggleButton value="energy" disabled={!hasEnergyData}>Energy</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            {ranked.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No distance recorded in this range, so this cannot be worked out yet. Add an odometer
                reading to your sessions and it fills in.
              </Typography>
            ) : (
              <Stack spacing={2} sx={{ mt: 2 }}>
                {ranked.map((row, index) => (
                  <Box key={row.id}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={700} noWrap>{row.name}</Typography>
                        <Chip size="small" variant="outlined" label={row.fuel_type} />
                        {index === 0 ? (
                          <Chip size="small" color="success" label="Most efficient" />
                        ) : (
                          <Typography variant="caption" color="text.secondary">
                            +{Math.round(((row.value / ranked[0].value) - 1) * 100)}%
                          </Typography>
                        )}
                      </Stack>
                      <Typography variant="body2" fontWeight={700} sx={{ whiteSpace: 'nowrap' }}>
                        {metric.format(row.value)}
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={(row.value / ranked[ranked.length - 1].value) * 100}
                      sx={{
                        height: 10,
                        borderRadius: 5,
                        '& .MuiLinearProgress-bar': {
                          backgroundColor: index === 0 ? theme.palette.success.main : theme.palette.primary.main,
                        },
                      }}
                    />
                  </Box>
                ))}
                {excludedCount > 0 ? (
                  <Typography variant="caption" color="text.secondary">
                    {excludedCount} vehicle{excludedCount === 1 ? '' : 's'} left out — no distance
                    {metricKey === 'energy' ? ' or charging' : ''} recorded in this range.
                  </Typography>
                ) : null}
              </Stack>
            )}
          </Card>

          {/* Full detail, replacing two bar charts and three leaderboards. */}
          <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>All figures</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Sort by any column to find the outlier.
            </Typography>
            <TableContainer sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    {COLUMNS.map((col) => (
                      <TableCell
                        key={col.id}
                        align={col.numeric ? 'right' : 'left'}
                        sortDirection={orderBy === (col.sortKey || col.id) ? order : false}
                        aria-sort={orderBy === (col.sortKey || col.id) ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <TableSortLabel
                          active={orderBy === (col.sortKey || col.id)}
                          direction={orderBy === (col.sortKey || col.id) ? order : 'asc'}
                          onClick={() => handleSort(col.sortKey || col.id)}
                        >
                          {col.label}
                        </TableSortLabel>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedVehicles.map((vehicle) => (
                    <TableRow key={vehicle.id} hover>
                      {COLUMNS.map((col) => (
                        <TableCell key={col.id} align={col.numeric ? 'right' : 'left'} sx={{ whiteSpace: 'nowrap' }}>
                          {(col.sortKey || col.id) === 'name' ? (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" fontWeight={700}>{vehicle.name}</Typography>
                              <Chip size="small" variant="outlined" label={vehicle.fuel_type} />
                            </Stack>
                          ) : col.format(Number(vehicle[col.sortKey || col.id] || 0))}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>

          {/* Where the money goes. */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
            <Card sx={{ p: 3, borderRadius: 4 }}>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>Driving vs other costs</Typography>
              <Stack spacing={2.5}>
                {[
                  { label: 'Driving spend', value: summary.session_cost, pct: summary.session_share_pct,
                    color: theme.palette.primary.main, hint: 'Charging and fuel' },
                  { label: 'Other costs', value: summary.expense_cost, pct: summary.expense_share_pct,
                    color: theme.palette.secondary.main, hint: 'Insurance, maintenance, tax…' },
                ].map((row) => (
                  <Box key={row.label}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1} sx={{ mb: 0.5 }}>
                      <Typography variant="body2" fontWeight={700}>{row.label}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                        {huf(row.value)} · {Math.round(row.pct || 0)}%
                      </Typography>
                    </Stack>
                    <LinearProgress variant="determinate" value={Math.min(100, Number(row.pct || 0))}
                      sx={{ height: 10, borderRadius: 5, '& .MuiLinearProgress-bar': { backgroundColor: row.color } }} />
                    <Typography variant="caption" color="text.secondary">{row.hint}</Typography>
                  </Box>
                ))}
              </Stack>
            </Card>

            <Card sx={{ p: 3, borderRadius: 4 }}>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>Cost categories</Typography>
              {categories.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No costs recorded in this range.</Typography>
              ) : (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                  <Box sx={{ width: 168, height: 168, flexShrink: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={categories} dataKey="total_amount" nameKey="category"
                          cx="50%" cy="50%" innerRadius={48} outerRadius={78} paddingAngle={3}
                          stroke={theme.palette.background.paper} strokeWidth={3}
                          isAnimationActive={chartAnimation}>
                          {categories.map((entry, index) => (
                            <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        {/* The name is formatted in the formatter, not in labelFormatter:
                            a pie tooltip has no label, so that one never ran and the row
                            read "insurance" while the legend beside it read "Insurance". */}
                        <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle}
                          formatter={(value, name) => [huf(value), formatCategoryLabel(name)]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </Box>
                  <Stack spacing={0.75} sx={{ flex: 1, width: '100%' }}>
                    {categories.map((entry, index) => (
                      <Stack key={entry.category} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                          <Box sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                            backgroundColor: COLORS[index % COLORS.length] }} />
                          <Typography variant="body2" noWrap>{formatCategoryLabel(entry.category)}</Typography>
                        </Stack>
                        <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                          {Math.round((Number(entry.total_amount) / categoryTotal) * 100)}%
                        </Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Stack>
              )}
            </Card>
          </Box>

          {/* Who you buy energy from. */}
          <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Providers</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              How often you stop where, and how much energy you take there. Named from
              the record's location, or from what the record itself says.
            </Typography>
            {providers.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No charging or fuel records in this range.
              </Typography>
            ) : (
              // Two rings rather than one: how often you stop somewhere and how much you
              // take on each stop are different questions, and the gap between them is
              // the point — a home charger is a handful of long sessions, a motorway
              // stop the reverse.
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                <ProviderPie title="Stops" slices={stopsSlices} chartAnimation={chartAnimation}
                  tooltipStyle={tooltipStyle} itemStyle={tooltipItemStyle} theme={theme}
                  formatValue={(value) => `${value} record${value === 1 ? '' : 's'}`} />
                <ProviderPie title="Energy" slices={energySlices} chartAnimation={chartAnimation}
                  tooltipStyle={tooltipStyle} itemStyle={tooltipItemStyle} theme={theme}
                  formatValue={fmt.energy} formatRate={(rate) => `${huf(rate)} / kWh`}
                  empty="No charging with a recorded kWh figure in this range." />
              </Box>
            )}
          </Card>

          {/* Per-vehicle detail. */}
          <Card sx={{ p: 3, borderRadius: 4 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between"
              alignItems={{ sm: 'center' }} spacing={2} sx={{ mb: 2 }}>
              <Box>
                <Typography variant="h6" fontWeight={700}>Single vehicle</Typography>
                <Typography variant="body2" color="text.secondary">Same range, one vehicle at a time.</Typography>
              </Box>
              <TextField select size="small" label="Vehicle" value={selectedVehicleId}
                onChange={(e) => setSelectedVehicleId(e.target.value)} sx={{ minWidth: 200 }}>
                {(data.vehicle_stats || []).map((v) => (
                  <MenuItem key={v.id} value={String(v.id)}>{v.name}</MenuItem>
                ))}
              </TextField>
            </Stack>

            {!drilldown ? (
              <Typography variant="body2" color="text.secondary">Pick a vehicle to see its detail.</Typography>
            ) : (
              <>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 2 }}>
                  <Figure label="Total cost" value={huf(drilldown.summary?.total_cost)} color={theme.palette.secondary.main} />
                  <Figure label="Distance" value={km(drilldown.summary?.distance_km)} color={theme.palette.primary.main} />
                  <Figure label={`Per 100 ${fmt.distanceShort}`} value={huf(drilldown.summary?.avg_cost_per_100km)} color={theme.palette.warning.main} />
                  <Figure label="Records" value={String(drilldown.summary?.total_records || 0)} color={theme.palette.success.main} />
                </Box>

                <Divider sx={{ mb: 2 }} />

                <Box sx={{ width: '100%', height: isMobile ? 200 : 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={drilldown.trend || []} margin={{ left: 4, right: 4 }}>
                      <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
                      <XAxis dataKey="period" tickFormatter={drilldownTick} axisLine={false} tickLine={false}
                        interval="preserveStartEnd" minTickGap={16}
                        tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                      <YAxis tickFormatter={compact} axisLine={false} tickLine={false} width={48}
                        tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle} labelFormatter={drilldownTooltipLabel}
                        formatter={(value, name) => [huf(value), name]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
                      <Bar dataKey="session_cost" name="Driving spend" stackId="cost"
                        shape={<StackTopBar above={['expense_cost']} />}
                        fill={theme.palette.primary.main} isAnimationActive={chartAnimation} />
                      <Bar dataKey="expense_cost" name="Other costs" stackId="cost"
                        shape={<StackTopBar />}
                        fill={theme.palette.secondary.main} isAnimationActive={chartAnimation} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
              </>
            )}
          </Card>
        </>
      )}

      <ExportOptionsDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onConfirm={handleExportConfirm}
        vehicles={(data.vehicle_stats || []).map((v) => ({ id: v.id, name: v.name }))}
        availability={{
          categories: (data.expense_categories || []).length > 0,
          providers: (data.providers || []).length > 0,
          drilldown: Boolean(drilldown),
        }}
        projectionAvailable={projectionOn}
      />

      {/* On document.body and parked off-screen — see the report block in App.css. It
          has to be laid out to be rasterised, so it cannot be display: none. */}
      {reportPayload
        ? createPortal(
          <AnalyticsReport
            data={reportPayload.data}
            chartData={reportPayload.chartData}
            forecast={reportPayload.projectionOn ? forecast : null}
            drilldown={reportPayload.drilldown}
            projectionOn={reportPayload.projectionOn}
            comparison={reportPayload.data.fuel_comparison || null}
            sections={reportPayload.sections}
            rangeLabel={RANGES.find((r) => r.value === range)?.label}
            trendBucket={reportPayload.bucket}
            drilldownBucket={reportPayload.drilldown?.trend_bucket || reportPayload.bucket}
            fmt={fmt}
            user={user}
            mode={theme.palette.mode}
            ref={reportRef}
          />,
          document.body,
        )
        : null}
    </Box>
  );
};

export default Analytics;
