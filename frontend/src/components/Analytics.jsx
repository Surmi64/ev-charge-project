import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { AnalyticsSkeleton } from './SectionSkeletons';
import { getCategoryBoxSx } from '../utils/categoryVisuals';
import { getFuelBoxSx } from '../utils/fuelVisuals';
import { supportsCharging } from '../utils/vehicleRules';

const COLORS = ['#00F5FF', '#FF00E5', '#32CD32', '#FFA500', '#8A2BE2'];
const RANGE_OPTIONS = [
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
];

const formatNumber = (value) => Number(value || 0).toLocaleString();
const formatCategoryLabel = (value) => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const Analytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [rangeKey, setRangeKey] = useState('all');
  const [analyticsReloadKey, setAnalyticsReloadKey] = useState(0);
  const [selectedVehicleId, setSelectedVehicleId] = useState('');
  const [drilldown, setDrilldown] = useState(null);
  const [loadingDrilldown, setLoadingDrilldown] = useState(false);
  const [drilldownError, setDrilldownError] = useState('');
  const [drilldownReloadKey, setDrilldownReloadKey] = useState(0);
  const theme = useTheme();

  useEffect(() => {
    const fetchAnalytics = async (attempt = 0) => {
      setLoading(true);
      setErrorMessage('');

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication token missing. Please sign in again.');
        }

        const res = await fetch(`/api/analytics/summary?range=${rangeKey}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          let detail = 'Analytics data is currently unavailable.';

          try {
            const payload = await res.json();
            detail = payload?.detail || detail;
          } catch {
            detail = 'Analytics data is currently unavailable.';
          }

          throw new Error(detail);
        }

        const payload = await res.json();
        if (!payload || typeof payload !== 'object') {
          throw new Error('Analytics response payload was invalid.');
        }

        setData(payload);
      } catch (error) {
        if (attempt < 1) {
          window.setTimeout(() => {
            fetchAnalytics(attempt + 1);
          }, 700);
          return;
        }

        const nextMessage = error instanceof Error ? error.message : 'Failed to load analytics';
        setData(null);
        setErrorMessage(nextMessage);
        toast.error(nextMessage);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [analyticsReloadKey, rangeKey]);

  useEffect(() => {
    if (!data?.vehicle_stats?.length) {
      setSelectedVehicleId('');
      return;
    }

    const exists = data.vehicle_stats.some((vehicle) => String(vehicle.id) === String(selectedVehicleId));
    if (!exists) {
      setSelectedVehicleId(String(data.vehicle_stats[0].id));
    }
  }, [data, selectedVehicleId]);

  useEffect(() => {
    if (!selectedVehicleId) {
      setDrilldown(null);
      setDrilldownError('');
      return;
    }

    const fetchDrilldown = async (attempt = 0) => {
      setLoadingDrilldown(true);
      setDrilldownError('');

      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication token missing. Please sign in again.');
        }

        const res = await fetch(`/api/analytics/vehicles/${selectedVehicleId}?range=${rangeKey}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          let detail = 'Vehicle drilldown is currently unavailable.';

          try {
            const payload = await res.json();
            detail = payload?.detail || detail;
          } catch {
            detail = 'Vehicle drilldown is currently unavailable.';
          }

          throw new Error(detail);
        }

        const payload = await res.json();
        if (!payload || typeof payload !== 'object') {
          throw new Error('Vehicle drilldown response payload was invalid.');
        }

        setDrilldown(payload);
      } catch (error) {
        if (attempt < 1) {
          window.setTimeout(() => {
            fetchDrilldown(attempt + 1);
          }, 700);
          return;
        }

        const nextMessage = error instanceof Error ? error.message : 'Failed to load vehicle drilldown';
        setDrilldown(null);
        setDrilldownError(nextMessage);
        toast.error(nextMessage);
      } finally {
        setLoadingDrilldown(false);
      }
    };

    fetchDrilldown();
  }, [drilldownReloadKey, rangeKey, selectedVehicleId]);

  if (loading) return <AnalyticsSkeleton />;
  if (!data) {
    return (
      <Box className="section-shell">
        <Typography variant="h4" fontWeight="800" sx={{ mb: 1 }}>
          Analytics
        </Typography>
        <Card sx={{ ...getCategoryBoxSx(theme, 'other'), p: { xs: 3, sm: 4 }, borderRadius: 4, maxWidth: 720 }}>
          <Stack spacing={1.25} alignItems="flex-start">
            <Chip size="small" label="Status" variant="outlined" />
            <Typography variant="h6">
              Analytics data unavailable
            </Typography>
            <Typography color="text.secondary">
              {errorMessage || 'Add sessions and expenses to generate analytics.'}
            </Typography>
            <Button
              variant="outlined"
              onClick={() => {
                setErrorMessage('');
                setAnalyticsReloadKey((current) => current + 1);
              }}
            >
              Retry
            </Button>
          </Stack>
        </Card>
      </Box>
    );
  }

  const tooltipStyle = {
    borderRadius: '16px',
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
    boxShadow: theme.palette.mode === 'dark'
      ? `0 18px 40px ${alpha('#000000', 0.32)}`
      : '0 14px 30px rgba(20, 31, 41, 0.12)',
    backdropFilter: 'blur(14px)',
  };
  const analyticsCardSx = {
    p: 3,
    borderRadius: 4,
    width: '100%',
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    minHeight: 420,
  };
  const summaryCardSx = {
    p: 3,
    borderRadius: 4,
    width: '100%',
    height: '100%',
    ...getCategoryBoxSx(theme, 'other'),
    borderColor: alpha(theme.palette.secondary.main, 0.72),
    boxShadow: `0 0 0 1px ${alpha(theme.palette.secondary.main, 0.14)} inset, 0 0 18px ${alpha(theme.palette.secondary.main, 0.12)}`,
  };
  const chartBodySx = {
    width: '100%',
    flex: 1,
    minHeight: 300,
  };
  const analyticsRowSx = {
    display: 'flex',
    gap: 3,
    flexWrap: 'wrap',
    mb: 0.5,
  };
  const twoColItemSx = {
    width: { xs: '100%', md: 'calc((100% - 24px) / 2)' },
    minWidth: 0,
    display: 'flex',
  };
  const threeColItemSx = {
    width: { xs: '100%', md: 'calc((100% - 48px) / 3)' },
    minWidth: 0,
    display: 'flex',
  };
  const energyVehicles = (data.vehicle_stats || []).filter((vehicle) => supportsCharging(vehicle.fuel_type));
  const distanceVehicles = (data.vehicle_stats || []).filter((vehicle) => vehicle.cost_per_100km !== null);
  const totalCostLeaderboard = [...(data.vehicle_stats || [])]
    .sort((left, right) => Number(right.total_cost || 0) - Number(left.total_cost || 0))
    .slice(0, 3);
  const efficiencyLeaderboard = [...distanceVehicles]
    .sort((left, right) => Number(right.cost_per_100km || 0) - Number(left.cost_per_100km || 0))
    .slice(0, 3);
  const extraCostLeaderboard = [...(data.vehicle_stats || [])]
    .sort((left, right) => Number(right.expense_cost || 0) - Number(left.expense_cost || 0))
    .slice(0, 3);
  const selectedVehicle = (data.vehicle_stats || []).find((vehicle) => String(vehicle.id) === String(selectedVehicleId));

  const StatCard = ({ title, value, unit, description, color = 'secondary.main' }) => (
    <Card sx={summaryCardSx}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
        <Typography variant="h4" fontWeight="800" sx={{ color }}>
          {formatNumber(value)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {unit}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
    </Card>
  );

  const SectionHeading = ({ title, description, action = null }) => (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', md: 'center' }}
      spacing={1.5}
      sx={{ mb: 1.5 }}
    >
      <Box>
        <Typography variant="h5" fontWeight="800" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {description}
        </Typography>
      </Box>
      {action}
    </Stack>
  );

  const LeaderboardCard = ({ title, items, metricKey, metricUnit, emptyText }) => (
    <Card sx={{ ...getCategoryBoxSx(theme, 'other'), p: 3, borderRadius: 4, width: '100%', height: '100%' }}>
      <Typography variant="h6" fontWeight="700" sx={{ mb: 2 }}>
        {title}
      </Typography>
      {items.length ? (
        <Stack spacing={1.25}>
          {items.map((vehicle) => (
            <Box key={`${title}-${vehicle.id}`} sx={{ ...getFuelBoxSx(theme, vehicle.fuel_type, { compact: true, borderOnly: true }) }}>
              <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                <Box>
                  <Typography variant="body2" fontWeight="700">
                    {vehicle.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatNumber(vehicle.distance_km)} km tracked
                  </Typography>
                </Box>
                <Typography variant="body2" fontWeight="800">
                  {formatNumber(vehicle[metricKey])} {metricUnit}
                </Typography>
              </Stack>
            </Box>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      )}
    </Card>
  );

  const reloadDrilldown = () => {
    setDrilldownError('');
    setDrilldownReloadKey((current) => current + 1);
  };

  return (
    <Box className="section-shell">
      <Stack
        direction={{ xs: 'column', xl: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', xl: 'center' }}
        spacing={2}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="h4" fontWeight="800" sx={{ mb: 0.75 }}>
            Analytics
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Comparison and trend view for cost structure, vehicle efficiency, and energy behavior.
          </Typography>
        </Box>

        <Card sx={{ ...getCategoryBoxSx(theme, 'other', { compact: true }), p: 1.25, borderRadius: 4 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={rangeKey}
            disabled={loading || loadingDrilldown}
            onChange={(_event, value) => {
              if (value) {
                setRangeKey(value);
              }
            }}
          >
            {RANGE_OPTIONS.map((option) => (
              <ToggleButton key={option.value} value={option.value} sx={{ px: 1.75, textTransform: 'none' }}>
                {option.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Card>
      </Stack>

      <Box sx={analyticsRowSx}>
        <Box sx={twoColItemSx}>
          <StatCard
            title="Operating Cost"
            value={data.summary?.total_operating_cost_huf}
            unit="HUF"
            description="All tracked operating cost across sessions and extra expenses in the selected range."
            color="secondary.main"
          />
        </Box>
        <Box sx={twoColItemSx}>
          <StatCard
            title="Tracked Distance"
            value={data.summary?.total_distance_km}
            unit="km"
            description="Distance covered across the currently filtered analytics window."
            color="success.main"
          />
        </Box>
        <Box sx={twoColItemSx}>
          <StatCard
            title="Average Cost / 100 km"
            value={data.summary?.avg_cost_per_100km}
            unit="HUF"
            description="Normalized operating cost for vehicles with distance data."
            color="warning.main"
          />
        </Box>
        <Box sx={twoColItemSx}>
          <StatCard
            title="Average Charging Cost"
            value={data.avg_cost_per_kwh}
            unit="HUF / kWh"
            description="Average charging network cost across filtered charging events."
            color="primary.main"
          />
        </Box>
      </Box>

      <SectionHeading
        title="Trends"
        description="Time-series panels stay here so the dashboard can remain compact and operational."
      />
      <Box sx={analyticsRowSx}>
        <Box sx={twoColItemSx}>
          <Card sx={{ ...analyticsCardSx, ...getCategoryBoxSx(theme, 'other') }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Monthly Operating Cost Split
            </Typography>
            <Box sx={chartBodySx}>
              <ResponsiveContainer>
                <BarChart data={data.monthly_trend || []}>
                  <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value, key) => [`${formatNumber(value)} HUF`, key === 'session_cost_huf' ? 'Driving spend' : 'Extra costs']}
                  />
                  <Bar dataKey="session_cost_huf" stackId="cost" fill={theme.palette.primary.main} radius={[10, 10, 0, 0]} />
                  <Bar dataKey="expense_cost_huf" stackId="cost" fill={theme.palette.secondary.main} radius={[10, 10, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Box>

        <Box sx={twoColItemSx}>
          <Card sx={{ ...analyticsCardSx, ...getFuelBoxSx(theme, 'electric', { borderOnly: true }) }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Energy Consumption Trend
            </Typography>
            <Box sx={chartBodySx}>
              <ResponsiveContainer>
                <AreaChart data={data.weekly_trend || []}>
                  <defs>
                    <linearGradient id="analytics-energy-gradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
                  <XAxis
                    dataKey="week"
                    tickFormatter={(value) => new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value) => [`${formatNumber(value)} kWh`, 'Energy']}
                    labelFormatter={(value) => new Date(value).toLocaleDateString()}
                  />
                  <Area
                    type="monotone"
                    dataKey="energy"
                    stroke={theme.palette.primary.main}
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#analytics-energy-gradient)"
                    dot={{ r: 0 }}
                    activeDot={{ r: 5, strokeWidth: 0, fill: theme.palette.secondary.main }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Box>
      </Box>

      <SectionHeading
        title="Vehicle Comparison"
        description="Heavy per-vehicle comparisons live here, separated from the dashboard overview."
      />
      <Box sx={analyticsRowSx}>
        <Box sx={twoColItemSx}>
          <Card sx={{ ...analyticsCardSx, ...getCategoryBoxSx(theme, 'other') }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Operating Cost per Vehicle
            </Typography>
            <Box sx={chartBodySx}>
              <ResponsiveContainer>
                <BarChart data={data.vehicle_stats || []} layout="vertical">
                  <defs>
                    <linearGradient id="analytics-cost-gradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={alpha(theme.palette.secondary.main, 0.55)} />
                      <stop offset="100%" stopColor={theme.palette.secondary.main} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 10" horizontal={false} stroke={theme.palette.divider} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={96} axisLine={false} tickLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <Tooltip formatter={(value) => [`${formatNumber(value)} HUF`, 'Operating cost']} contentStyle={tooltipStyle} />
                  <Bar dataKey="total_cost" fill="url(#analytics-cost-gradient)" radius={[0, 8, 8, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Box>

        <Box sx={twoColItemSx}>
          <Card sx={{ ...analyticsCardSx, ...getCategoryBoxSx(theme, 'other') }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Cost per 100 km by Vehicle
            </Typography>
            <Box sx={chartBodySx}>
              <ResponsiveContainer>
                <BarChart data={distanceVehicles} layout="vertical">
                  <defs>
                    <linearGradient id="analytics-distance-gradient" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor={alpha(theme.palette.success.main, 0.5)} />
                      <stop offset="100%" stopColor={theme.palette.primary.main} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="4 10" horizontal={false} stroke={theme.palette.divider} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={96} axisLine={false} tickLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                  <Tooltip
                    formatter={(value, _name, entry) => [
                      `${formatNumber(value)} HUF / 100 km`,
                      `${formatNumber(entry?.payload?.distance_km || 0)} km tracked`,
                    ]}
                    contentStyle={tooltipStyle}
                  />
                  <Bar dataKey="cost_per_100km" fill="url(#analytics-distance-gradient)" radius={[0, 8, 8, 0]} barSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Box>
      </Box>

      <SectionHeading
        title="Cost Structure"
        description="Expense category mix and energy distribution stay together so cost structure reads as one coherent section."
      />
      <Box sx={analyticsRowSx}>
        <Box sx={twoColItemSx}>
          <Card sx={{ ...analyticsCardSx, ...getCategoryBoxSx(theme, 'other') }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Expense Breakdown
            </Typography>
            <Box
              sx={{
                ...chartBodySx,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1.15fr) minmax(220px, 0.85fr)' },
                gap: 2,
              }}
            >
              <Box sx={{ minHeight: 300 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={data.expense_categories || []}
                      dataKey="total_amount"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius={54}
                      outerRadius={88}
                      paddingAngle={3}
                      stroke={theme.palette.background.paper}
                      strokeWidth={4}
                    >
                      {(data.expense_categories || []).map((entry, index) => (
                        <Cell key={`expense-cell-${entry.category}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => `${formatNumber(value)} HUF`} labelFormatter={formatCategoryLabel} contentStyle={tooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>
              </Box>
              <Stack spacing={1.25} justifyContent="center">
                {(data.expense_categories || []).map((category, index) => (
                  <Box key={category.category} sx={{ ...getCategoryBoxSx(theme, category.category, { compact: true }) }}>
                    <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: COLORS[index % COLORS.length] }} />
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" fontWeight="700" noWrap sx={{ textTransform: 'capitalize' }}>
                            {formatCategoryLabel(category.category)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {category.item_count} items
                          </Typography>
                        </Box>
                      </Stack>
                      <Typography variant="body2" fontWeight="800">
                        {formatNumber(category.total_amount)} HUF
                      </Typography>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </Box>
          </Card>
        </Box>

        <Box sx={twoColItemSx}>
          <Card sx={{ ...analyticsCardSx, ...getFuelBoxSx(theme, 'electric', { borderOnly: true }) }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Energy by Vehicle
            </Typography>
            <Box
              sx={{
                ...chartBodySx,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'minmax(0, 1.15fr) minmax(220px, 0.85fr)' },
                gap: 2,
                alignItems: 'stretch',
              }}
            >
              <Box sx={{ minHeight: 300 }}>
                {energyVehicles.length ? (
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie
                        data={energyVehicles}
                        dataKey="total_energy"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={54}
                        outerRadius={88}
                        paddingAngle={3}
                        stroke={theme.palette.background.paper}
                        strokeWidth={4}
                      >
                        {energyVehicles.map((vehicle, index) => (
                          <Cell key={`energy-cell-${vehicle.id}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${formatNumber(value)} kWh`, 'Energy']} contentStyle={tooltipStyle} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <Box sx={{ height: '100%', minHeight: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Typography color="text.secondary">
                      No charge-capable vehicles with energy data yet.
                    </Typography>
                  </Box>
                )}
              </Box>
              <Stack spacing={1.25} justifyContent="center">
                {energyVehicles.map((vehicle, index) => (
                  <Box
                    key={vehicle.id}
                    sx={{
                      ...getFuelBoxSx(theme, vehicle.fuel_type, { compact: true, borderOnly: true }),
                      display: 'grid',
                      gridTemplateColumns: '14px minmax(0, 1fr) auto',
                      gap: 1,
                      alignItems: 'center',
                    }}
                  >
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: COLORS[index % COLORS.length], boxShadow: `0 0 12px ${alpha(COLORS[index % COLORS.length], 0.35)}` }} />
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight="700" noWrap>
                        {vehicle.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                        {vehicle.fuel_type}
                      </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight="800">
                      {formatNumber(vehicle.total_energy)} kWh
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </Box>
          </Card>
        </Box>
      </Box>

      <SectionHeading
        title="Vehicle Drilldown"
        description="Use a focused vehicle panel for detailed history instead of repeating all metrics across the whole page."
        action={
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="analytics-vehicle-select-label">Vehicle</InputLabel>
            <Select
              labelId="analytics-vehicle-select-label"
              value={selectedVehicleId}
              label="Vehicle"
              disabled={loadingDrilldown || !(data.vehicle_stats || []).length}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
            >
              {(data.vehicle_stats || []).map((vehicle) => (
                <MenuItem key={vehicle.id} value={String(vehicle.id)}>
                  {vehicle.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        }
      />
      <Card sx={{ ...getCategoryBoxSx(theme, 'other'), p: 3, borderRadius: 4, mb: 0.5 }}>
        {loadingDrilldown ? (
          <Box sx={{ minHeight: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        ) : drilldownError ? (
          <Box sx={{ minHeight: 280, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center', gap: 1.25 }}>
            <Chip size="small" label="Vehicle detail" variant="outlined" />
            <Typography variant="h6" fontWeight="700">
              Vehicle drilldown unavailable
            </Typography>
            <Typography color="text.secondary">
              {drilldownError}
            </Typography>
            <Button variant="outlined" onClick={reloadDrilldown}>
              Retry
            </Button>
          </Box>
        ) : drilldown && selectedVehicle ? (
          <Stack spacing={3}>
            <Box sx={{ ...getFuelBoxSx(theme, selectedVehicle.fuel_type, { borderOnly: true }), p: 2.5, borderRadius: 4 }}>
              <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                <Box>
                  <Typography variant="h6" fontWeight="800">
                    {drilldown.vehicle?.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                    {drilldown.vehicle?.fuel_type} • {drilldown.vehicle?.make} {drilldown.vehicle?.model}
                  </Typography>
                </Box>
                <Chip label={rangeKey.toUpperCase()} size="small" variant="outlined" />
              </Stack>
            </Box>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6} md={3}>
                <Card sx={{ ...summaryCardSx, minHeight: 130 }}>
                  <Typography variant="subtitle2" color="text.secondary">Total Cost</Typography>
                  <Typography variant="h5" fontWeight="800" sx={{ mt: 1 }}>{formatNumber(drilldown.summary?.total_cost_huf)} HUF</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card sx={{ ...summaryCardSx, minHeight: 130 }}>
                  <Typography variant="subtitle2" color="text.secondary">Distance</Typography>
                  <Typography variant="h5" fontWeight="800" sx={{ mt: 1 }}>{formatNumber(drilldown.summary?.distance_km)} km</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card sx={{ ...summaryCardSx, minHeight: 130 }}>
                  <Typography variant="subtitle2" color="text.secondary">Session Spend</Typography>
                  <Typography variant="h5" fontWeight="800" sx={{ mt: 1 }}>{formatNumber(drilldown.summary?.session_cost_huf)} HUF</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} sm={6} md={3}>
                <Card sx={{ ...summaryCardSx, minHeight: 130 }}>
                  <Typography variant="subtitle2" color="text.secondary">Cost / 100 km</Typography>
                  <Typography variant="h5" fontWeight="800" sx={{ mt: 1 }}>{formatNumber(drilldown.summary?.avg_cost_per_100km)} HUF</Typography>
                </Card>
              </Grid>
            </Grid>

            <Grid container spacing={3}>
              <Grid item xs={12} lg={7}>
                <Card sx={{ ...getCategoryBoxSx(theme, 'other'), p: 3, borderRadius: 4, height: '100%' }}>
                  <Typography variant="h6" fontWeight="700" sx={{ mb: 2.5 }}>
                    Vehicle Monthly Trend
                  </Typography>
                  <Box sx={{ width: '100%', height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={drilldown.monthly_trend || []}>
                        <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(value, key) => [`${formatNumber(value)} HUF`, key === 'session_cost_huf' ? 'Driving spend' : 'Extra costs']}
                        />
                        <Bar dataKey="session_cost_huf" stackId="cost" fill={theme.palette.primary.main} radius={[10, 10, 0, 0]} />
                        <Bar dataKey="expense_cost_huf" stackId="cost" fill={theme.palette.secondary.main} radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </Box>
                </Card>
              </Grid>

              <Grid item xs={12} lg={5}>
                <Card sx={{ ...getCategoryBoxSx(theme, 'other'), p: 3, borderRadius: 4, height: '100%' }}>
                  <Typography variant="h6" fontWeight="700" sx={{ mb: 2.5 }}>
                    Vehicle Expense Mix
                  </Typography>
                  {(drilldown.expense_categories || []).length ? (
                    <Stack spacing={1.25}>
                      {drilldown.expense_categories.map((category) => (
                        <Box key={category.category} sx={{ ...getCategoryBoxSx(theme, category.category, { compact: true }) }}>
                          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="center">
                            <Box>
                              <Typography variant="body2" fontWeight="700" sx={{ textTransform: 'capitalize' }}>
                                {formatCategoryLabel(category.category)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {category.item_count} items
                              </Typography>
                            </Box>
                            <Typography variant="body2" fontWeight="800">
                              {formatNumber(category.total_amount)} HUF
                            </Typography>
                          </Stack>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <Box sx={{ minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Typography color="text.secondary">
                        No extra expenses for this vehicle in the selected range.
                      </Typography>
                    </Box>
                  )}
                </Card>
              </Grid>
            </Grid>

            <Card sx={{ ...getCategoryBoxSx(theme, 'other'), p: 3, borderRadius: 4 }}>
              <Typography variant="h6" fontWeight="700" sx={{ mb: 2.5 }}>
                Recent Vehicle Events
              </Typography>
              {(drilldown.recent_events || []).length ? (
                <Stack divider={<Divider flexItem />} spacing={0}>
                  {drilldown.recent_events.map((event, index) => (
                    <Box
                      key={`${event.occurred_at}-${index}`}
                      sx={{
                        py: 1.75,
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 1.5,
                        flexDirection: { xs: 'column', sm: 'row' },
                      }}
                    >
                      <Box>
                        <Typography variant="body2" fontWeight="700" sx={{ textTransform: 'capitalize' }}>
                          {event.category}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {new Date(event.occurred_at).toLocaleDateString()} • {event.event_type}
                        </Typography>
                        {event.description ? (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.4 }}>
                            {event.description}
                          </Typography>
                        ) : null}
                      </Box>
                      <Stack alignItems={{ xs: 'flex-start', sm: 'flex-end' }} spacing={0.25}>
                        <Typography variant="body2" fontWeight="800">
                          {formatNumber(event.total_cost)} HUF
                        </Typography>
                        {event.energy_kwh ? (
                          <Typography variant="caption" color="text.secondary">
                            {formatNumber(event.energy_kwh)} kWh
                          </Typography>
                        ) : null}
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              ) : (
                <Typography color="text.secondary">
                  No events found for this vehicle in the selected range.
                </Typography>
              )}
            </Card>
          </Stack>
        ) : (
          <Box sx={{ minHeight: 180, display: 'flex', alignItems: 'center' }}>
            <Typography color="text.secondary">
              No vehicle data available for drilldown.
            </Typography>
          </Box>
        )}
      </Card>

      <SectionHeading
        title="Leaderboards"
        description="A compact closing section for quick ranking instead of repeating full fleet rows."
      />
      <Box sx={{ ...analyticsRowSx, mb: 0 }}>
        <Box sx={threeColItemSx}>
          <LeaderboardCard
            title="Highest Total Cost"
            items={totalCostLeaderboard}
            metricKey="total_cost"
            metricUnit="HUF"
            emptyText="No cost data available yet."
          />
        </Box>
        <Box sx={threeColItemSx}>
          <LeaderboardCard
            title="Highest Cost per 100 km"
            items={efficiencyLeaderboard}
            metricKey="cost_per_100km"
            metricUnit="HUF"
            emptyText="No normalized distance data available yet."
          />
        </Box>
        <Box sx={threeColItemSx}>
          <LeaderboardCard
            title="Highest Extra Cost Load"
            items={extraCostLeaderboard}
            metricKey="expense_cost"
            metricUnit="HUF"
            emptyText="No extra cost data available yet."
          />
        </Box>
      </Box>
    </Box>
  );
};

export default Analytics;