import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useDelayedLoading } from '../utils/useDelayedLoading';

const MODES = [
  { value: 'instant', label: 'Every new record' },
  { value: 'daily', label: 'Daily summary' },
  { value: 'weekly', label: 'Weekly summary' },
];

const readError = async (res, fallback) => {
  const data = await res.json().catch(() => null);
  return data?.detail || fallback;
};

/**
 * Who is emailed when a charge or fill-up is recorded: the account itself, a fleet
 * manager, a bookkeeper. Each address picks instant mail or a digest, and optionally
 * only some vehicles. An address other than the account's own confirms first, from a
 * link in its inbox — until then it is listed but receives nothing.
 */
const NotificationSettings = () => {
  const [recipients, setRecipients] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: '', mode: 'instant', vehicleIds: [] });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const showSkeleton = useDelayedLoading(loading);

  const load = useCallback(async () => {
    try {
      const [recipientRes, vehicleRes] = await Promise.all([
        apiFetch('/api/notifications/recipients'),
        apiFetch('/api/vehicles'),
      ]);
      if (recipientRes.ok) setRecipients(await recipientRes.json());
      if (vehicleRes.ok) setVehicles(await vehicleRes.json());
    } catch {
      toast.error('Could not load notification settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const vehicleName = (id) => vehicles.find((vehicle) => vehicle.id === id)?.name || `Vehicle ${id}`;
  const vehicleSummary = (ids) => (ids && ids.length ? ids.map(vehicleName).join(', ') : 'All vehicles');

  const handleAdd = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch('/api/notifications/recipients', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email.trim(),
          mode: form.mode,
          // Nothing picked means every vehicle, including ones added later.
          vehicle_ids: form.vehicleIds.length ? form.vehicleIds : null,
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not add this address'));
      const added = await res.json();
      setRecipients((current) => [...current, added]);
      setForm({ email: '', mode: 'instant', vehicleIds: [] });
      toast.success(added.confirmed ? 'Notifications on' : `Confirmation sent to ${added.email}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  const act = async (recipient, path, options, done) => {
    setBusyId(recipient.id);
    try {
      const res = await apiFetch(path, options);
      if (!res.ok) throw new Error(await readError(res, 'That did not work'));
      const data = await res.json().catch(() => null);
      if (options.method === 'DELETE') {
        setRecipients((current) => current.filter((item) => item.id !== recipient.id));
      } else if (data?.id) {
        setRecipients((current) => current.map((item) => (item.id === data.id ? data : item)));
      }
      toast.success(done);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const base = (recipient) => `/api/notifications/recipients/${recipient.id}`;

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>New record emails</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Email someone whenever a charge or fill-up is recorded — yourself, a fleet manager,
        a bookkeeper. Summaries arrive at 07:00, daily or on Mondays. Any address other than
        your own gets a confirmation link first and receives nothing until it says yes.
      </Typography>

      <Box component="form" onSubmit={handleAdd}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'flex-start' }}>
          <TextField
            label="Email" type="email" required size="small" fullWidth
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <TextField
            select label="When" size="small" sx={{ minWidth: { md: 180 } }}
            value={form.mode}
            onChange={(event) => setForm({ ...form, mode: event.target.value })}
          >
            {MODES.map((mode) => <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>)}
          </TextField>
          {vehicles.length > 1 ? (
            <TextField
              select label="Vehicles" size="small" sx={{ minWidth: { md: 180 } }}
              value={form.vehicleIds}
              onChange={(event) => setForm({ ...form, vehicleIds: event.target.value })}
              slotProps={{
                select: {
                  multiple: true,
                  displayEmpty: true,
                  renderValue: (ids) => vehicleSummary(ids),
                },
                inputLabel: { shrink: true },
              }}
            >
              {vehicles.map((vehicle) => <MenuItem key={vehicle.id} value={vehicle.id}>{vehicle.name}</MenuItem>)}
            </TextField>
          ) : null}
          <Button type="submit" variant="contained" disabled={saving || !form.email.trim()} sx={{ flexShrink: 0, minHeight: 40 }}>
            {saving ? 'Adding…' : 'Add'}
          </Button>
        </Stack>
      </Box>

      <Divider sx={{ my: 2.5 }} />

      {showSkeleton ? (
        <Stack spacing={1.5}>
          <Skeleton variant="rounded" height={56} />
          <Skeleton variant="rounded" height={56} />
        </Stack>
      ) : null}

      {!loading && recipients.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          Nobody is notified yet. Add your own address to try it.
        </Typography>
      ) : null}

      {!loading ? (
        <Stack spacing={1.5} divider={<Divider flexItem />}>
          {recipients.map((recipient) => (
            <Stack
              key={recipient.id}
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ sm: 'center' }}
              sx={{ minWidth: 0 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Typography fontWeight={600} noWrap sx={{ minWidth: 0 }}>{recipient.email}</Typography>
                  <Chip
                    size="small"
                    label={recipient.confirmed ? 'Active' : 'Awaiting confirmation'}
                    color={recipient.confirmed ? 'success' : 'warning'}
                    variant="outlined"
                  />
                </Stack>
                <Typography variant="body2" color="text.secondary">{vehicleSummary(recipient.vehicle_ids)}</Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  select size="small" sx={{ minWidth: 170 }}
                  value={recipient.mode}
                  disabled={busyId === recipient.id}
                  onChange={(event) => act(
                    recipient, base(recipient),
                    { method: 'PATCH', body: JSON.stringify({ mode: event.target.value }) },
                    'Saved',
                  )}
                  slotProps={{ htmlInput: { 'aria-label': `When to email ${recipient.email}` } }}
                >
                  {MODES.map((mode) => <MenuItem key={mode.value} value={mode.value}>{mode.label}</MenuItem>)}
                </TextField>
                {recipient.confirmed ? (
                  <Button
                    size="small" disabled={busyId === recipient.id}
                    onClick={() => act(recipient, `${base(recipient)}/test`, { method: 'POST' }, 'Test email on its way')}
                  >
                    Test
                  </Button>
                ) : (
                  <Button
                    size="small" disabled={busyId === recipient.id}
                    onClick={() => act(recipient, `${base(recipient)}/resend`, { method: 'POST' }, 'Confirmation sent again')}
                  >
                    Resend
                  </Button>
                )}
                <Tooltip title="Remove">
                  <span>
                    <IconButton
                      aria-label={`Remove ${recipient.email}`}
                      disabled={busyId === recipient.id}
                      onClick={() => act(recipient, base(recipient), { method: 'DELETE' }, 'Removed')}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Paper>
  );
};

export default NotificationSettings;
