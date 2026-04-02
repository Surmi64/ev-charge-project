import React, { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';
import { DashboardSkeleton } from './SectionSkeletons';
import { getCategoryBoxSx } from '../utils/categoryVisuals';
import { getFuelBoxSx } from '../utils/fuelVisuals';

const formatNumber = (value) => Number(value || 0).toLocaleString();

const getAlertTone = (theme, level) => {
  if (level === 'warning') {
    return {
      color: theme.palette.warning.main,
      borderColor: alpha(theme.palette.warning.main, 0.48),
      backgroundColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.16),
    };
  }

  if (level === 'success') {
    return {
      color: theme.palette.success.main,
      borderColor: alpha(theme.palette.success.main, 0.4),
      backgroundColor: alpha(theme.palette.success.main, theme.palette.mode === 'dark' ? 0.12 : 0.16),
    };
  }

  return {
    color: theme.palette.info.main,
    borderColor: alpha(theme.palette.info.main, 0.42),
    backgroundColor: alpha(theme.palette.info.main, theme.palette.mode === 'dark' ? 0.12 : 0.16),
  };
};

const getDeltaMeta = (current, previous, preference = 'lower') => {
  const delta = Number(current || 0) - Number(previous || 0);

  if (previous <= 0) {
    if (current > 0) {
      return {
        label: 'New activity vs last month',
        tone: 'neutral',
      };
    }

    return {
      label: 'No change',
      tone: 'neutral',
    };
  }

  const pct = Math.round((delta / previous) * 100);
  const improved = preference === 'lower' ? delta <= 0 : delta >= 0;

  return {
    label: `${pct > 0 ? '+' : ''}${pct}% vs last month`,
    tone: improved ? 'good' : 'bad',
  };
};

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    const fetchStats = async (attempt = 0) => {
      try {
        const token = localStorage.getItem('token');
        if (!token) {
          throw new Error('Authentication token missing. Please sign in again.');
        }

        const res = await fetch('/api/dashboard/stats', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          let detail = 'Failed to load dashboard statistics';

          try {
            const payload = await res.json();
            if (payload?.detail) {
              detail = payload.detail;
            }
          } catch {
            // Ignore JSON parsing errors and use fallback message.
          }

          throw new Error(detail);
        }

        const payload = await res.json();
        if (!payload || typeof payload !== 'object') {
          throw new Error('Dashboard returned an empty response.');
        }

        setStats(payload);
        setErrorMessage('');
      } catch (error) {
        if (attempt < 1) {
          window.setTimeout(() => {
            fetchStats(attempt + 1);
          }, 700);
          return;
        }

        const message = error instanceof Error ? error.message : 'Failed to load dashboard statistics';
        setErrorMessage(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  if (loading) return <DashboardSkeleton />;
  if (!stats) {
    return (
      <Box className="section-shell" sx={{ maxWidth: 760, mx: 'auto' }}>
        <Card sx={{ ...getCategoryBoxSx(theme, 'other'), p: { xs: 3, sm: 3.5 }, borderRadius: 4 }}>
          <Stack spacing={1.25} alignItems="flex-start">
            <Chip size="small" label="Status" variant="outlined" />
            <Typography variant="h6" fontWeight="700">
              Dashboard data unavailable
            </Typography>
            <Typography color="text.secondary">
              {errorMessage || 'The dashboard did not return usable data.'}
            </Typography>
            <Button
              variant="contained"
              onClick={() => {
                setLoading(true);
                setErrorMessage('');
                setStats(null);
                const token = localStorage.getItem('token');
                fetch('/api/dashboard/stats', {
                  headers: token ? { Authorization: `Bearer ${token}` } : {},
                })
                  .then(async (res) => {
                    if (!res.ok) {
                      const payload = await res.json().catch(() => null);
                      throw new Error(payload?.detail || 'Failed to load dashboard statistics');
                    }
                    return res.json();
                  })
                  .then((payload) => {
                    setStats(payload);
                  })
                  .catch((error) => {
                    const message = error instanceof Error ? error.message : 'Failed to load dashboard statistics';
                    setErrorMessage(message);
                    toast.error(message);
                  })
                  .finally(() => {
                    setLoading(false);
                  });
              }}
            >
              Retry
            </Button>
          </Stack>
        </Card>
      </Box>
    );
  }

  const currentMonth = stats.current_month || {};
  const previousMonth = stats.previous_month || {};
  const comparisonCards = [
    {
      title: 'Operating Cost',
      current: currentMonth.total_cost_huf,
      previous: previousMonth.total_cost_huf,
      unit: 'HUF',
      preference: 'lower',
    },
    {
      title: 'Tracked Distance',
      current: currentMonth.total_distance_km,
      previous: previousMonth.total_distance_km,
      unit: 'km',
      preference: 'higher',
    },
    {
      title: 'Cost per 100 km',
      current: currentMonth.avg_cost_per_100km,
      previous: previousMonth.avg_cost_per_100km,
      unit: 'HUF',
      preference: 'lower',
    },
  ];
  const summaryRows = [
    [
      {
        kind: 'kpi',
        title: 'This Month Cost',
        value: currentMonth.total_cost_huf,
        unit: 'HUF',
        description: 'Combined session, fueling, charging, and extra expenses.',
        color: 'secondary.main',
      },
      {
        kind: 'kpi',
        title: 'Driving Spend',
        value: currentMonth.session_cost_huf,
        unit: 'HUF',
        description: 'Charging and fueling related spend for the current month.',
        color: 'primary.main',
      },
      {
        kind: 'kpi',
        title: 'Extra Costs',
        value: currentMonth.expense_cost_huf,
        unit: 'HUF',
        description: 'Maintenance, insurance, tax, and other non-session costs.',
        color: 'warning.main',
      },
    ],
    comparisonCards.map((item) => ({ kind: 'comparison', ...item })),
  ];
  const tooltipStyle = {
    borderRadius: '16px',
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
    boxShadow: theme.palette.mode === 'dark'
      ? `0 18px 40px ${alpha('#000000', 0.32)}`
      : '0 14px 30px rgba(20, 31, 41, 0.12)',
    backdropFilter: 'blur(14px)',
  };
  const summaryCardSx = {
    p: 3,
    borderRadius: 4,
    width: '100%',
    minWidth: 0,
    height: '100%',
    ...getCategoryBoxSx(theme, 'other'),
    borderColor: alpha(theme.palette.secondary.main, 0.72),
    boxShadow: `0 0 0 1px ${alpha(theme.palette.secondary.main, 0.14)} inset, 0 0 18px ${alpha(theme.palette.secondary.main, 0.12)}`,
  };
  const gridItemSx = {
    display: 'flex',
    minWidth: 0,
  };
  const fixedCardSx = {
    width: '100%',
    minWidth: 0,
    height: '100%',
  };
  const summaryRowSx = {
    display: 'flex',
    gap: 3,
    flexWrap: 'wrap',
    mb: 3,
  };
  const summaryRowItemSx = {
    width: {
      xs: '100%',
      md: 'calc((100% - 48px) / 3)',
    },
    minWidth: 0,
    display: 'flex',
  };
  const wideDashboardRowSx = {
    display: 'flex',
    gap: 3,
    flexWrap: 'wrap',
    mb: 0.5,
  };
  const wideDashboardPrimaryItemSx = {
    width: {
      xs: '100%',
      md: 'calc((((100% - 48px) / 3) * 2) + 24px)',
    },
    minWidth: 0,
    display: 'flex',
  };
  const wideDashboardSecondaryItemSx = {
    width: {
      xs: '100%',
      md: 'calc((100% - 48px) / 3)',
    },
    minWidth: 0,
    display: 'flex',
  };
  const emptyDashboardSlotSx = {
    width: {
      xs: '100%',
      md: 'calc((100% - 48px) / 3)',
    },
    minWidth: 0,
    display: {
      xs: 'none',
      md: 'block',
    },
  };
  const compositionItems = [
    {
      label: 'Driving spend',
      value: currentMonth.session_cost_huf || 0,
      color: theme.palette.primary.main,
    },
    {
      label: 'Extra costs',
      value: currentMonth.expense_cost_huf || 0,
      color: theme.palette.secondary.main,
    },
  ];
  const compositionTotal = compositionItems.reduce((sum, item) => sum + item.value, 0);


  const KPIStatCard = ({ title, value, unit, description, color = 'secondary.main' }) => (
    <Card sx={summaryCardSx}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1, minWidth: 0, flexWrap: 'wrap' }}>
        <Typography variant="h4" fontWeight="800" sx={{ color, minWidth: 0, overflowWrap: 'anywhere' }}>
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

  const ComparisonCard = ({ title, current, previous, unit, preference }) => {
    const deltaMeta = getDeltaMeta(current, previous, preference);
    const tone = deltaMeta.tone === 'good'
      ? theme.palette.success.main
      : deltaMeta.tone === 'bad'
        ? theme.palette.error.main
        : theme.palette.text.secondary;

    return (
      <Card sx={{ ...getCategoryBoxSx(theme, 'other'), ...fixedCardSx, p: 2.5, borderRadius: 4 }}>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h5" fontWeight="800" sx={{ mb: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {formatNumber(current)} {unit}
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" sx={{ minWidth: 0 }}>
          <Chip
            size="small"
            label={deltaMeta.label}
            variant="outlined"
            sx={{
              maxWidth: '100%',
              color: tone,
              borderColor: alpha(tone, 0.42),
              backgroundColor: alpha(tone, theme.palette.mode === 'dark' ? 0.12 : 0.08),
              '& .MuiChip-label': {
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              },
            }}
          />
          <Typography variant="caption" color="text.secondary">
            Previous: {formatNumber(previous)} {unit}
          </Typography>
        </Stack>
      </Card>
    );
  };

  return (
    <Box className="section-shell">
      <Typography variant="h4" fontWeight="800" sx={{ mb: 0.75 }}>
        Dashboard
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Monthly overview first, with the items that need attention surfaced before deeper analysis.
      </Typography>

      {summaryRows.map((row, index) => (
        <Box sx={{ ...summaryRowSx, mb: index === summaryRows.length - 1 ? 0.5 : 3 }} key={`summary-row-${index}`}>
          {row.map((item) => (
            <Box sx={summaryRowItemSx} key={item.title}>
              {item.kind === 'kpi' ? <KPIStatCard {...item} /> : <ComparisonCard {...item} />}
            </Box>
          ))}
        </Box>
      ))}

      <Box sx={wideDashboardRowSx}>
        <Box sx={wideDashboardPrimaryItemSx}>
          <Card sx={{ ...getCategoryBoxSx(theme, 'other'), ...fixedCardSx, p: 3, borderRadius: 4 }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 0.75 }}>
              Monthly Operating Cost Split
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Session-related spend and extra costs are kept together here, without pulling the page into full analytics mode.
            </Typography>
            <Box sx={{ width: '100%', height: isMobile ? 260 : 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.monthly_stats || []}>
                  <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: 'transparent' }}
                    contentStyle={tooltipStyle}
                    formatter={(value, key) => [`${formatNumber(value)} HUF`, key === 'session_cost_huf' ? 'Driving spend' : 'Extra costs']}
                  />
                  <Bar dataKey="session_cost_huf" stackId="cost" fill={theme.palette.primary.main} />
                  <Bar dataKey="expense_cost_huf" stackId="cost" radius={[10, 10, 0, 0]} fill={theme.palette.secondary.main} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Box>

        <Box sx={wideDashboardSecondaryItemSx}>
          <Card sx={{ ...getCategoryBoxSx(theme, 'other'), ...fixedCardSx, p: 3, borderRadius: 4 }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 2 }}>
              Current Month Composition
            </Typography>
            <Stack spacing={2}>
              {compositionItems.map((item) => (
                <Box key={item.label}>
                  <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
                    <Typography variant="body2" color="text.secondary">
                      {item.label}
                    </Typography>
                    <Typography variant="body2" fontWeight="700">
                      {formatNumber(item.value)} HUF
                    </Typography>
                  </Stack>
                  <Box sx={{ height: 8, borderRadius: 999, backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.12), overflow: 'hidden' }}>
                    <Box
                      sx={{
                        width: `${compositionTotal > 0 ? (item.value / compositionTotal) * 100 : 0}%`,
                        height: '100%',
                        backgroundColor: item.color,
                      }}
                    />
                  </Box>
                </Box>
              ))}
              <Divider flexItem />
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Energy tracked this month
                </Typography>
                <Typography variant="h6" fontWeight="800">
                  {formatNumber(currentMonth.total_energy_kwh)} kWh
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Largest expense category this month
                </Typography>
                <Typography variant="body1" fontWeight="700" sx={{ textTransform: 'capitalize', overflowWrap: 'anywhere' }}>
                  {stats.cost_composition?.top_expense_category?.category || 'No extra expenses yet'}
                </Typography>
                {stats.cost_composition?.top_expense_category ? (
                  <Typography variant="body2" color="text.secondary">
                    {formatNumber(stats.cost_composition.top_expense_category.total_amount)} HUF
                  </Typography>
                ) : null}
              </Box>
            </Stack>
          </Card>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        <Box sx={summaryRowItemSx}>
          <Card sx={{ ...getCategoryBoxSx(theme, 'other'), ...fixedCardSx, p: 3, borderRadius: 4 }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 2 }}>
              Fleet Snapshot
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mb: 2 }}>
              <Chip label={`${stats.fleet_snapshot?.electric_count || 0} electric`} sx={{ ...getFuelBoxSx(theme, 'electric', { compact: true, borderOnly: true }), height: 32 }} />
              <Chip label={`${stats.fleet_snapshot?.hybrid_count || 0} hybrid`} sx={{ ...getFuelBoxSx(theme, 'hybrid', { compact: true, borderOnly: true }), height: 32 }} />
              <Chip label={`${stats.fleet_snapshot?.combustion_count || 0} fuel`} sx={{ ...getFuelBoxSx(theme, 'petrol', { compact: true, borderOnly: true }), height: 32 }} />
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              {stats.fleet_snapshot?.total_vehicles || 0} vehicles tracked across the account.
            </Typography>
            <Stack spacing={1.25}>
              {(stats.fleet_snapshot?.top_cost_vehicles || []).map((vehicle) => (
                <Box key={vehicle.id} sx={{ ...getFuelBoxSx(theme, vehicle.fuel_type, { compact: true, borderOnly: true }) }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" fontWeight="700" sx={{ overflowWrap: 'anywhere' }}>
                        {vehicle.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {formatNumber(vehicle.distance_km)} km tracked
                      </Typography>
                    </Box>
                    <Typography variant="body2" fontWeight="800" sx={{ flexShrink: 0 }}>
                      {formatNumber(vehicle.total_cost)} HUF
                    </Typography>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </Card>
        </Box>

        <Box sx={summaryRowItemSx}>
          <Card sx={{ ...getCategoryBoxSx(theme, 'other'), ...fixedCardSx, p: 3, borderRadius: 4 }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 2 }}>
              Alerts and Reminders
            </Typography>
            <Stack spacing={1.5} sx={{ mb: 2.5 }}>
              {(stats.alerts || []).map((alert) => {
                const tone = getAlertTone(theme, alert.level);

                return (
                  <Box
                    key={`${alert.level}-${alert.title}`}
                    sx={{
                      p: 1.5,
                      minWidth: 0,
                      borderRadius: 3,
                      border: `1px solid ${tone.borderColor}`,
                      backgroundColor: tone.backgroundColor,
                    }}
                  >
                    <Typography variant="body2" fontWeight="700" sx={{ color: tone.color, mb: 0.25, overflowWrap: 'anywhere' }}>
                      {alert.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {alert.description}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>

            <Divider flexItem sx={{ mb: 2.5 }} />

            <Typography variant="subtitle1" fontWeight="700" sx={{ mb: 1.5 }}>
              Upcoming recurring expenses
            </Typography>
            {(stats.upcoming_reminders || []).length ? (
              <Stack spacing={1.25}>
                {stats.upcoming_reminders.map((reminder) => (
                  <Box key={reminder.id} sx={{ ...getCategoryBoxSx(theme, reminder.category || 'other', { compact: true }) }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1} sx={{ minWidth: 0 }}>
                      <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="body2" fontWeight="700" sx={{ textTransform: 'capitalize', overflowWrap: 'anywhere' }}>
                          {reminder.category}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                          {reminder.vehicle_name || 'General'} • {new Date(reminder.next_due_date).toLocaleDateString()}
                        </Typography>
                      </Box>
                      <Typography variant="body2" fontWeight="800" sx={{ flexShrink: 0 }}>
                        {formatNumber(reminder.amount)} HUF
                      </Typography>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No recurring reminders due in the next 30 days.
              </Typography>
            )}
          </Card>
        </Box>

        <Box sx={emptyDashboardSlotSx} />
      </Box>
    </Box>
  );
};

export default Dashboard;