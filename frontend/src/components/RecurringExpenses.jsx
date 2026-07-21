import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  Add as AddIcon,
  CheckCircleOutline as LogIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  PauseCircleOutline as PauseIcon,
  PlayCircleOutline as PlayIcon,
} from '@mui/icons-material';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useDelayedLoading } from '../utils/useDelayedLoading';
import { getCategoryChipSx } from '../utils/categoryVisuals';
import { EXPENSE_CATEGORIES } from '../utils/expenseCategories';
import { CardListSkeleton } from './SectionSkeletons';

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const EMPTY = {
  vehicle_id: '',
  category: 'insurance',
  amount: '',
  currency: 'HUF',
  frequency: 'yearly',
  next_due_date: new Date().toISOString().slice(0, 10),
  description: '',
  is_active: true,
};

const daysUntil = (isoDate) => {
  if (!isoDate) return null;
  const diff = new Date(isoDate).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.round(diff / 86400000);
};

const dueLabel = (days) => {
  if (days === null) return { text: '—', color: 'default' };
  if (days < 0) return { text: `${Math.abs(days)} days overdue`, color: 'error' };
  if (days === 0) return { text: 'Due today', color: 'warning' };
  if (days <= 14) return { text: `In ${days} days`, color: 'warning' };
  return { text: `In ${days} days`, color: 'default' };
};

const RecurringExpenses = () => {
  const theme = useTheme();
  const [reminders, setReminders] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  // Skip the placeholder entirely when the data beats the delay.
  const showSkeleton = useDelayedLoading(loading);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busyId, setBusyId] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);

  const load = useCallback(async () => {
    try {
      const [remindersRes, vehiclesRes] = await Promise.all([
        apiFetch('/api/recurring-expenses'),
        apiFetch('/api/vehicles?include_archived=true'),
      ]);
      if (remindersRes.ok) setReminders(await remindersRes.json());
      if (vehiclesRes.ok) setVehicles(await vehiclesRes.json());
    } catch {
      toast.error('Could not load recurring costs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const vehicleName = useCallback(
    (id) => {
      const v = vehicles.find((item) => String(item.id) === String(id));
      return v ? v.name || `${v.make} ${v.model}` : 'All vehicles';
    },
    [vehicles],
  );

  const sorted = useMemo(
    () => [...reminders].sort((a, b) => {
      if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
      return new Date(a.next_due_date) - new Date(b.next_due_date);
    }),
    [reminders],
  );

  const handleOpen = (reminder = null) => {
    setEditing(reminder);
    setForm(reminder
      ? { ...EMPTY, ...reminder, vehicle_id: reminder.vehicle_id ? String(reminder.vehicle_id) : '', amount: String(reminder.amount) }
      : EMPTY);
    setOpen(true);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const body = {
      vehicle_id: form.vehicle_id === '' ? null : Number(form.vehicle_id),
      category: form.category,
      amount: Number(form.amount),
      currency: form.currency || 'HUF',
      frequency: form.frequency,
      next_due_date: form.next_due_date,
      description: form.description || null,
      is_active: form.is_active,
    };
    try {
      const res = await apiFetch(
        editing ? `/api/recurring-expenses/${editing.id}` : '/api/recurring-expenses',
        { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Could not save');
      }
      toast.success(editing ? 'Reminder updated' : 'Reminder added');
      setOpen(false);
      load();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const act = async (reminder, action) => {
    setBusyId(reminder.id);
    try {
      const config = {
        log: { path: `/api/recurring-expenses/${reminder.id}/log-expense`, method: 'POST', body: '{}', done: 'Cost logged' },
        toggle: {
          path: `/api/recurring-expenses/${reminder.id}`, method: 'PATCH',
          body: JSON.stringify({ is_active: !reminder.is_active }),
          done: reminder.is_active ? 'Reminder paused' : 'Reminder resumed',
        },
        remove: { path: `/api/recurring-expenses/${reminder.id}`, method: 'DELETE', done: 'Reminder deleted' },
      }[action];

      const res = await apiFetch(config.path, { method: config.method, ...(config.body ? { body: config.body } : {}) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Action failed');
      }
      toast.success(config.done);
      setPendingDelete(null);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyId(null);
    }
  };

  if (showSkeleton) return <CardListSkeleton rows={3} />;
  if (loading) return null;

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Costs that come back on a schedule. Logging one records the expense and moves the date forward.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
          Add reminder
        </Button>
      </Stack>

      {sorted.length === 0 ? (
        <Card sx={{ p: 4, borderRadius: 4, textAlign: 'center' }}>
          <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>No recurring costs yet</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            Add insurance, road tax or a service interval and GarageOS will remind you.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>Add reminder</Button>
        </Card>
      ) : (
        <Stack spacing={1.5}>
          {sorted.map((reminder) => {
            const days = daysUntil(reminder.next_due_date);
            const due = dueLabel(days);
            const busy = busyId === reminder.id;
            return (
              <Card key={reminder.id} sx={{ p: 2, borderRadius: 3, opacity: reminder.is_active ? 1 : 0.6 }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
                  <Box sx={{ minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {reminder.description || `${reminder.category} — ${vehicleName(reminder.vehicle_id)}`}
                      </Typography>
                      <Chip size="small" variant="outlined" label={reminder.category} sx={getCategoryChipSx(theme, reminder.category)} />
                      {!reminder.is_active ? <Chip size="small" variant="outlined" label="Paused" /> : null}
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {Number(reminder.amount).toLocaleString()} {reminder.currency} · {reminder.frequency} · {vehicleName(reminder.vehicle_id)}
                    </Typography>
                  </Box>

                  <Stack direction="row" spacing={1} alignItems="center">
                    {reminder.is_active ? (
                      <Chip size="small" color={due.color} variant="outlined" label={due.text} />
                    ) : null}
                    <Tooltip title={reminder.is_active ? 'Log this cost now' : 'Resume to log'}>
                      <span>
                        <IconButton size="small" color="success" disabled={!reminder.is_active || busy} onClick={() => act(reminder, 'log')}>
                          <LogIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={reminder.is_active ? 'Pause reminder' : 'Resume reminder'}>
                      <span>
                        <IconButton size="small" disabled={busy} onClick={() => act(reminder, 'toggle')}>
                          {reminder.is_active ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Edit reminder">
                      <span>
                        <IconButton size="small" color="primary" disabled={busy} onClick={() => handleOpen(reminder)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete reminder">
                      <span>
                        <IconButton size="small" color="error" disabled={busy} onClick={() => setPendingDelete(reminder)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                </Stack>
              </Card>
            );
          })}
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="sm">
        <form onSubmit={handleSubmit}>
          <DialogTitle>{editing ? 'Edit reminder' : 'Add reminder'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              <TextField select label="Vehicle" fullWidth value={form.vehicle_id}
                onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}
                helperText="Optional — leave empty for a household cost">
                <MenuItem value="">All vehicles</MenuItem>
                {vehicles.filter((v) => !v.is_archived).map((v) => (
                  <MenuItem key={v.id} value={String(v.id)}>{v.name || `${v.make} ${v.model}`}</MenuItem>
                ))}
              </TextField>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField select label="Category" fullWidth value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <MenuItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</MenuItem>
                  ))}
                </TextField>
                <TextField select label="Repeats" fullWidth value={form.frequency}
                  onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
                  {FREQUENCIES.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
                </TextField>
              </Stack>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Amount" type="number" fullWidth required value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                <TextField label="Next due" type="date" fullWidth required value={form.next_due_date}
                  onChange={(e) => setForm({ ...form, next_due_date: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true } }} />
              </Stack>
              <TextField label="Description" fullWidth value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                helperText="Shown in the list, e.g. “Compulsory insurance”" />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)} fullWidth maxWidth="xs">
        <DialogTitle>Delete reminder</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            This removes the reminder only. Costs already logged from it stay in your records.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={() => act(pendingDelete, 'remove')}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RecurringExpenses;
