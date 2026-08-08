import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
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
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Add as AddIcon,
  ArrowDownward as DownIcon,
  ArrowUpward as UpIcon,
  ChevronRight as ChevronIcon,
  Close as CloseIcon,
  Visibility as VisibilityIcon,
} from '@mui/icons-material';
import { useAuth } from '../context/useAuth';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useDelayedLoading } from '../utils/useDelayedLoading';
import { getCategoryChipSx } from '../utils/categoryVisuals';
import { formatCategoryLabel } from '../utils/expenseCategories';
import { createFormatters } from '../utils/units';
import { StackTopBar } from '../utils/chartShapes';
import { DashboardSkeleton } from './SectionSkeletons';
import RecordDialog from './RecordDialog';

const monthLabel = (value) => {
  if (!value) return '';
  const [year, month] = value.split('-');
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(undefined, { month: 'short' });
};

/** Percentage change, framed so "good" depends on the metric. */
const getDelta = (current, previous, preference = 'lower') => {
  const now = Number(current || 0);
  const before = Number(previous || 0);
  if (before <= 0) return null;
  const percent = Math.round(((now - before) / before) * 100);
  if (percent === 0) return { percent: 0, tone: 'neutral' };
  const improved = preference === 'lower' ? percent < 0 : percent > 0;
  return { percent, tone: improved ? 'good' : 'bad' };
};

const DeltaChip = ({ delta }) => {
  const theme = useTheme();
  if (!delta) return null;
  const color =
    delta.tone === 'good' ? theme.palette.success.main
      : delta.tone === 'bad' ? theme.palette.error.main
        : theme.palette.text.secondary;
  const Icon = delta.percent > 0 ? UpIcon : DownIcon;
  return (
    <Stack direction="row" spacing={0.25} alignItems="center">
      {delta.percent !== 0 ? <Icon sx={{ fontSize: 16, color }} /> : null}
      <Typography variant="body2" fontWeight={700} sx={{ color }}>
        {Math.abs(delta.percent)}%
      </Typography>
      <Typography variant="body2" color="text.secondary">vs last month</Typography>
    </Stack>
  );
};

// Every alert used to send you to the ledger, including the ones about recurring
// costs and vehicles, which are not on that tab. The id prefix says what the alert
// is about, so route on that.
const ALERT_TARGETS = {
  'overdue-reminders': { to: '/activity?tab=recurring', label: 'Review' },
  'inactive-vehicles': { to: '/vehicles', label: 'Vehicles' },
  'cost-increase': { to: '/analytics', label: 'Analyse' },
};

const getAlertTarget = (alert) => ALERT_TARGETS[String(alert.id || '').split(':')[0]] || null;

const SectionTitle = ({ children, action }) => (
  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
    <Typography variant="h6" fontWeight={700}>{children}</Typography>
    {action}
  </Stack>
);

/**
 * What needs attention, what the month cost, what just happened — in that order.
 *
 * The previous layout led with six KPI cards, two of which ("This Month Cost" and
 * "Operating Cost") rendered the very same number under different labels. The month
 * now has one headline figure with the detail underneath it.
 */
const Dashboard = () => {
  const theme = useTheme();
  const navigate = useNavigate();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const chartAnimation = !useMediaQuery('(prefers-reduced-motion: reduce)');

  const { user, updateUser } = useAuth();
  // Money, distance and volume all follow the account's settings.
  const fmt = useMemo(() => createFormatters(user), [user]);
  const huf = fmt.money;
  const compact = fmt.numberCompact;   // tengelyekre: penznem nelkul
  const [stats, setStats] = useState(null);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  // Skip the placeholder entirely when the data beats the delay.
  const showSkeleton = useDelayedLoading(loading);
  const [errorMessage, setErrorMessage] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const dismissed = useMemo(() => user?.dismissed_alerts || [], [user]);

  // Persisted on the account, not in localStorage, so the choice follows the user to
  // another device. The list is pruned to ids that still exist, which stops it from
  // growing every month.
  const persistDismissed = useCallback(async (nextList) => {
    updateUser({ dismissed_alerts: nextList });
    const res = await apiFetch('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ dismissed_alerts: nextList }),
    });
    if (!res.ok) {
      updateUser({ dismissed_alerts: dismissed });
      toast.error('Could not save that. The alert will be back on refresh.');
    }
  }, [dismissed, updateUser]);

  const load = useCallback(async () => {
    try {
      const [statsRes, vehiclesRes] = await Promise.all([
        apiFetch('/api/dashboard/stats'),
        apiFetch('/api/vehicles'),
      ]);
      if (!statsRes.ok) {
        const payload = await statsRes.json().catch(() => null);
        throw new Error(payload?.detail || 'Could not load the dashboard');
      }
      setStats(await statsRes.json());
      if (vehiclesRes.ok) setVehicles(await vehiclesRes.json());
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error.message);
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (showSkeleton) return <DashboardSkeleton />;
  if (loading) return null;

  if (!stats) {
    return (
      <Box className="section-shell stagger" sx={{ maxWidth: 620, mx: 'auto' }}>
        <Card sx={{ p: 3.5, borderRadius: 4, textAlign: 'center' }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Dashboard unavailable</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>{errorMessage}</Typography>
          <Button variant="contained" onClick={() => { setLoading(true); load(); }}>Try again</Button>
        </Card>
      </Box>
    );
  }

  const current = stats.current_month || {};
  const previous = stats.previous_month || {};
  const alerts = stats.alerts || [];
  const alertIds = alerts.map((alert) => alert.id).filter(Boolean);
  const visibleAlerts = alerts.filter((alert) => !alert.id || !dismissed.includes(alert.id));
  const hiddenCount = alerts.length - visibleAlerts.length;

  // Keep only ids that are still live, so last month's dismissals fall out.
  const dismissAlert = (alert) => {
    if (!alert.id) return;
    persistDismissed([...dismissed.filter((id) => alertIds.includes(id)), alert.id]);
  };

  const restoreAlerts = () => {
    persistDismissed(dismissed.filter((id) => !alertIds.includes(id)));
  };
  const reminders = stats.upcoming_reminders || [];
  const recent = stats.recent_activity || [];
  const fleet = stats.vehicle_stats || [];

  if ((stats.total_records || 0) === 0) {
    return (
      <Box className="section-shell stagger">
        <Typography variant="h4" component="h1" fontWeight="800" sx={{ mb: 0.5 }}>Dashboard</Typography>
        <Card sx={{ p: 4, borderRadius: 4, textAlign: 'center', maxWidth: 620, mx: 'auto', mt: 3 }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Nothing logged yet</Typography>
          <Typography color="text.secondary" sx={{ mb: 2.5 }}>
            {vehicles.length === 0
              ? 'Start by adding a vehicle, then log your first charge, tank of fuel or cost.'
              : 'Log your first charge, tank of fuel or cost and this page fills in.'}
          </Typography>
          {vehicles.length === 0 ? (
            <Button variant="contained" onClick={() => navigate('/vehicles')}>Add a vehicle</Button>
          ) : (
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>Add record</Button>
          )}
        </Card>
        <RecordDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} vehicles={vehicles} editing={null} />
      </Box>
    );
  }

  const costDelta = getDelta(current.total_cost, previous.total_cost, 'lower');
  const supporting = [
    { label: 'Driving spend', value: huf(current.session_cost), hint: `${current.session_count || 0} sessions`, color: theme.palette.primary.main },
    { label: 'Other costs', value: huf(current.expense_cost), hint: `${current.expense_count || 0} entries`, color: theme.palette.secondary.main },
    { label: `Cost ${fmt.perDistanceLabel}`, value: fmt.moneyPerHundred(current.avg_cost_per_100km), hint: `${fmt.distance(current.total_distance_km)} tracked`, color: theme.palette.warning.main },
  ];

  const tooltipStyle = {
    borderRadius: 12,
    backgroundColor: theme.palette.background.paper,
    border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
  };

  const maxFleetCost = Math.max(...fleet.map((v) => Number(v.total_cost || 0)), 1);

  return (
    <Box className="section-shell stagger">
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight="800" sx={{ mb: 0.5 }}>Dashboard</Typography>
          <Typography variant="body1" color="text.secondary">
            {new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} so far.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>Add record</Button>
      </Stack>

      {/* 1. Anything that needs a decision comes first, minus what was dismissed. */}
      {visibleAlerts.length > 0 ? (
        <Stack spacing={1} sx={{ mb: 1 }}>
          {visibleAlerts.map((alert) => (
            <Alert
              key={alert.id || alert.title}
              severity={alert.level === 'warning' ? 'warning' : alert.level === 'success' ? 'success' : 'info'}
              sx={{ borderRadius: 2 }}
              action={
                <Stack direction="row" spacing={0.5} alignItems="center">
                  {getAlertTarget(alert) ? (
                    <Button color="inherit" size="small" onClick={() => navigate(getAlertTarget(alert).to)}>
                      {getAlertTarget(alert).label}
                    </Button>
                  ) : null}
                  <IconButton
                    size="small"
                    color="inherit"
                    aria-label={`Dismiss: ${alert.title}`}
                    onClick={() => dismissAlert(alert)}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Stack>
              }
            >
              <strong>{alert.title}</strong> — {alert.description}
            </Alert>
          ))}
        </Stack>
      ) : null}

      {hiddenCount > 0 ? (
        <Button
          size="small"
          startIcon={<VisibilityIcon />}
          onClick={restoreAlerts}
          sx={{ mb: 1, alignSelf: 'flex-start' }}
        >
          Show {hiddenCount} hidden {hiddenCount === 1 ? 'alert' : 'alerts'}
        </Button>
      ) : null}

      {/* 2. One headline number for the month, then the detail behind it. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Typography variant="body2" color="text.secondary">Total this month</Typography>
        <Stack direction="row" spacing={2} alignItems="baseline" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <Typography variant="h3" component="div" fontWeight={800} sx={{ lineHeight: 1.1 }}>
            {huf(current.total_cost)}
          </Typography>
          <DeltaChip delta={costDelta} />
        </Stack>

        <Divider sx={{ mb: 2 }} />

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
          {supporting.map((item) => (
            <Box key={item.label} sx={{ borderLeft: `3px solid ${item.color}`, pl: 1.5 }}>
              <Typography variant="body2" color="text.secondary">{item.label}</Typography>
              <Typography variant="h6" component="div" fontWeight={700}>{item.value}</Typography>
              <Typography variant="caption" color="text.secondary">{item.hint}</Typography>
            </Box>
          ))}
        </Box>
      </Card>

      {/* 3. The trend behind the headline. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <SectionTitle action={<Button size="small" endIcon={<ChevronIcon />} onClick={() => navigate('/analytics')}>Analytics</Button>}>
          Last 12 months
        </SectionTitle>
        <Box sx={{ width: '100%', height: isMobile ? 220 : 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.monthly_stats || []} margin={{ left: 4, right: 4 }}>
              <CartesianGrid strokeDasharray="4 10" vertical={false} stroke={theme.palette.divider} />
              <XAxis dataKey="month" tickFormatter={monthLabel} axisLine={false} tickLine={false}
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
              <YAxis tickFormatter={compact} axisLine={false} tickLine={false} width={48}
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} />
              <Tooltip
                cursor={{ fill: alpha(theme.palette.primary.main, 0.06) }}
                contentStyle={tooltipStyle}
                formatter={(value, name) => [huf(value), name]}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={9} />
              <Bar dataKey="session_cost" name="Driving spend" stackId="cost"
                shape={<StackTopBar above={['expense_cost']} />}
                fill={theme.palette.primary.main} isAnimationActive={chartAnimation} />
              <Bar dataKey="expense_cost" name="Other costs" stackId="cost"
                shape={<StackTopBar />}
                fill={theme.palette.secondary.main} isAnimationActive={chartAnimation} />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Card>

      {/* 4. What just happened, and what is coming. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 3, borderRadius: 4 }}>
          <SectionTitle action={<Button size="small" endIcon={<ChevronIcon />} onClick={() => navigate('/activity')}>All records</Button>}>
            Recent
          </SectionTitle>
          {recent.length === 0 ? (
            <Typography color="text.secondary" variant="body2">Nothing logged yet this month.</Typography>
          ) : (
            <Stack divider={<Divider />}>
              {recent.slice(0, 5).map((item) => (
                <Stack key={`${item.activity_type}-${item.id}`} direction="row" justifyContent="space-between"
                  alignItems="center" spacing={1} sx={{ py: 1.25 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                      <Typography variant="body2" fontWeight={700} noWrap>{item.title}</Typography>
                      <Chip size="small" variant="outlined" label={formatCategoryLabel(item.category)}
                        sx={getCategoryChipSx(theme, item.category)} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {new Date(item.occurred_at).toLocaleDateString()} · {item.vehicle_name}
                    </Typography>
                  </Box>
                  <Typography variant="body2" fontWeight={700} sx={{ whiteSpace: 'nowrap' }}>
                    {huf(item.amount)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </Card>

        <Card sx={{ p: 3, borderRadius: 4 }}>
          <SectionTitle action={<Button size="small" endIcon={<ChevronIcon />} onClick={() => navigate('/activity?tab=recurring')}>Manage</Button>}>
            Coming up
          </SectionTitle>
          {reminders.length === 0 ? (
            <Typography color="text.secondary" variant="body2">
              No recurring costs due. Add one under Records → Recurring.
            </Typography>
          ) : (
            <Stack divider={<Divider />}>
              {reminders.slice(0, 5).map((reminder) => {
                const days = Math.round(
                  (new Date(reminder.next_due_date).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000,
                );
                return (
                  <Stack key={reminder.id} direction="row" justifyContent="space-between" alignItems="center"
                    spacing={1} sx={{ py: 1.25 }}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700} noWrap>
                        {reminder.description || formatCategoryLabel(reminder.category)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {reminder.vehicle_name} · {huf(reminder.amount)}
                      </Typography>
                    </Box>
                    <Chip size="small" variant="outlined"
                      color={days < 0 ? 'error' : days <= 14 ? 'warning' : 'default'}
                      label={days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`} />
                  </Stack>
                );
              })}
            </Stack>
          )}
        </Card>
      </Box>

      {/* 5. Where the money goes across the fleet. */}
      {fleet.length > 0 ? (
        <Card sx={{ p: 3, borderRadius: 4 }}>
          <SectionTitle action={<Button size="small" endIcon={<ChevronIcon />} onClick={() => navigate('/vehicles')}>Vehicles</Button>}>
            Cost by vehicle, all time
          </SectionTitle>
          <Stack spacing={2}>
            {fleet.map((vehicle) => (
              <Box key={vehicle.id}>
                <Stack direction="row" justifyContent="space-between" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="body2" fontWeight={700} noWrap>{vehicle.name}</Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    {huf(vehicle.total_cost)}
                    {vehicle.cost_per_100km ? ` · ${fmt.moneyPerHundred(vehicle.cost_per_100km)} ${fmt.perDistanceLabel}` : ''}
                  </Typography>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={(Number(vehicle.total_cost || 0) / maxFleetCost) * 100}
                  sx={{ height: 8, borderRadius: 4 }}
                />
              </Box>
            ))}
          </Stack>
        </Card>
      ) : null}

      <RecordDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} vehicles={vehicles} editing={null} />
    </Box>
  );
};

export default Dashboard;
