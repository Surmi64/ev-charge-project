import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
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
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useDelayedLoading } from '../utils/useDelayedLoading';
import { getChartColors } from '../utils/chartColors';
import { formatCategoryLabel } from '../utils/expenseCategories';
import { AnalyticsSkeleton } from './SectionSkeletons';

const RANGES = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'ytd', label: 'Year' },
  { value: 'all', label: 'All' },
];

const huf = (v) => `${Math.round(Number(v || 0)).toLocaleString()} HUF`;
const km = (v) => `${Math.round(Number(v || 0)).toLocaleString()} km`;
const compact = (v) =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(v || 0));
const monthLabel = (value) => {
  if (!value) return '';
  const [y, m] = value.split('-');
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
};

const COLUMNS = [
  { id: 'name', label: 'Vehicle', numeric: false },
  { id: 'total_cost', label: 'Total cost', numeric: true, format: huf },
  { id: 'session_cost', label: 'Driving', numeric: true, format: huf },
  { id: 'expense_cost', label: 'Other', numeric: true, format: huf },
  { id: 'distance_km', label: 'Distance', numeric: true, format: km },
  { id: 'cost_per_100km', label: 'Per 100 km', numeric: true, format: (v) => (v ? huf(v) : '—') },
  { id: 'total_energy', label: 'Energy', numeric: true, format: (v) => (v ? `${Math.round(v).toLocaleString()} kWh` : '—') },
];

// Three ways to read "efficient", because they disagree and the disagreement matters:
// a car can be the cheapest to drive while looking expensive overall simply because
// its insurance is. Lower is better for all three.
const EFFICIENCY_METRICS = {
  running: {
    label: 'Cost to drive',
    unit: 'HUF / 100 km',
    note: 'Charging and fuel only — what it costs to actually move the car.',
    compute: (v) => (v.distance_km > 0 ? (Number(v.session_cost || 0) / v.distance_km) * 100 : null),
    format: huf,
  },
  total: {
    label: 'Total cost',
    unit: 'HUF / 100 km',
    note: 'Everything divided by distance — fuel plus insurance, tax, maintenance.',
    compute: (v) => (v.distance_km > 0 ? Number(v.cost_per_100km || 0) : null),
    format: huf,
  },
  energy: {
    label: 'Energy use',
    unit: 'kWh / 100 km',
    note: 'Consumption regardless of price. Only vehicles that charge appear here.',
    compute: (v) => (v.distance_km > 0 && v.total_energy > 0 ? (Number(v.total_energy) / v.distance_km) * 100 : null),
    format: (v) => `${Number(v).toFixed(1)} kWh`,
  },
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
  const COLORS = getChartColors(theme);

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

  const metric = EFFICIENCY_METRICS[metricKey];
  const hasEnergyData = (data?.vehicle_stats || []).some(
    (v) => v.distance_km > 0 && Number(v.total_energy || 0) > 0,
  );

  // Vehicles without distance (or without charging, for the energy view) cannot be
  // placed on this scale, so they are counted out rather than shown as zero.
  const ranked = useMemo(() => {
    const rows = (data?.vehicle_stats || [])
      .map((v) => ({ ...v, value: metric.compute(v) }))
      .filter((v) => v.value !== null && v.value > 0);
    return rows.sort((a, b) => a.value - b.value);
  }, [data, metric]);

  const excludedCount = (data?.vehicle_stats || []).length - ranked.length;

  // Declared after hasEnergyData on purpose: the dependency array is evaluated during
  // render, so referencing it earlier hits the temporal dead zone and throws.
  useEffect(() => {
    if (metricKey === 'energy' && !hasEnergyData) setMetricKey('running');
  }, [metricKey, hasEnergyData]);

  const handleSort = (columnId) => {
    if (orderBy === columnId) setOrder(order === 'asc' ? 'desc' : 'asc');
    else { setOrderBy(columnId); setOrder(columnId === 'name' ? 'asc' : 'desc'); }
  };

  const tooltipStyle = {
    borderRadius: 12,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
  };

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
        {rangeSelector}
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
              <Figure label="Total cost" value={huf(summary.total_operating_cost_huf)} hint={rangeLabel}
                color={theme.palette.secondary.main} />
              <Figure label="Distance" value={km(summary.total_distance_km)}
                hint={`${(data.vehicle_stats || []).length} vehicles`} color={theme.palette.primary.main} />
              <Figure label="Cost per 100 km" value={huf(summary.avg_cost_per_100km)} hint="across the fleet"
                color={theme.palette.warning.main} />
              <Figure label="Cost per kWh" value={huf(data.avg_cost_per_kwh)}
                hint={`${Math.round(summary.total_energy_kwh || 0).toLocaleString()} kWh charged`}
                color={theme.palette.success.main} />
            </Box>
          </Card>

          {/* Cost over time, with the efficiency line the dashboard does not show. */}
          <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
            <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Cost over time</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Bars are spend, the line is cost per 100 km — a month can look expensive simply because you drove more.
            </Typography>
            <Box sx={{ width: '100%', height: isMobile ? 240 : 320 }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data.monthly_trend || []} margin={{ left: 4, right: 4 }}>
                  <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} axisLine={false} tickLine={false}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <YAxis yAxisId="cost" tickFormatter={compact} axisLine={false} tickLine={false} width={48}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <YAxis yAxisId="eff" orientation="right" tickFormatter={compact} axisLine={false} tickLine={false} width={48}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [huf(value), name]} />
                  <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
                  <Bar yAxisId="cost" dataKey="session_cost_huf" name="Driving spend" stackId="cost"
                    fill={theme.palette.primary.main} isAnimationActive={chartAnimation} />
                  <Bar yAxisId="cost" dataKey="expense_cost_huf" name="Other costs" stackId="cost" radius={[8, 8, 0, 0]}
                    fill={theme.palette.secondary.main} isAnimationActive={chartAnimation} />
                  <Line yAxisId="eff" type="monotone" dataKey="avg_cost_per_100km" name="Cost per 100 km"
                    stroke={theme.palette.warning.main} strokeWidth={2} dot={false} isAnimationActive={chartAnimation} />
                </ComposedChart>
              </ResponsiveContainer>
            </Box>
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
                        sortDirection={orderBy === col.id ? order : false}
                        aria-sort={orderBy === col.id ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <TableSortLabel
                          active={orderBy === col.id}
                          direction={orderBy === col.id ? order : 'asc'}
                          onClick={() => handleSort(col.id)}
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
                          {col.id === 'name' ? (
                            <Stack direction="row" spacing={1} alignItems="center">
                              <Typography variant="body2" fontWeight={700}>{vehicle.name}</Typography>
                              <Chip size="small" variant="outlined" label={vehicle.fuel_type} />
                            </Stack>
                          ) : col.format(Number(vehicle[col.id] || 0))}
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
                  { label: 'Driving spend', value: summary.session_cost_huf, pct: summary.session_share_pct,
                    color: theme.palette.primary.main, hint: 'Charging and fuel' },
                  { label: 'Other costs', value: summary.expense_cost_huf, pct: summary.expense_share_pct,
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
                        <Tooltip contentStyle={tooltipStyle} formatter={(value) => huf(value)}
                          labelFormatter={formatCategoryLabel} />
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
                  <Figure label="Total cost" value={huf(drilldown.summary?.total_cost_huf)} color={theme.palette.secondary.main} />
                  <Figure label="Distance" value={km(drilldown.summary?.distance_km)} color={theme.palette.primary.main} />
                  <Figure label="Per 100 km" value={huf(drilldown.summary?.avg_cost_per_100km)} color={theme.palette.warning.main} />
                  <Figure label="Records" value={String(drilldown.summary?.total_records || 0)} color={theme.palette.success.main} />
                </Box>

                <Divider sx={{ mb: 2 }} />

                <Box sx={{ width: '100%', height: isMobile ? 200 : 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={drilldown.monthly_trend || []} margin={{ left: 4, right: 4 }}>
                      <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
                      <XAxis dataKey="month" tickFormatter={monthLabel} axisLine={false} tickLine={false}
                        tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                      <YAxis tickFormatter={compact} axisLine={false} tickLine={false} width={48}
                        tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                      <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [huf(value), name]} />
                      <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
                      <Bar dataKey="session_cost_huf" name="Driving spend" stackId="cost"
                        fill={theme.palette.primary.main} isAnimationActive={chartAnimation} />
                      <Bar dataKey="expense_cost_huf" name="Other costs" stackId="cost" radius={[8, 8, 0, 0]}
                        fill={theme.palette.secondary.main} isAnimationActive={chartAnimation} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </Box>
              </>
            )}
          </Card>
        </>
      )}
    </Box>
  );
};

export default Analytics;
