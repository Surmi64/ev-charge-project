import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import {
  EvStation as ChargingIcon,
  LocalGasStation as FuelingIcon,
  ReceiptLong as CostIcon,
} from '@mui/icons-material';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { getAllowedSessionTypes } from '../utils/vehicleRules';
import { EXPENSE_CATEGORIES } from '../utils/expenseCategories';

const RECORD_TYPES = [
  { value: 'charging', label: 'Charging', icon: <ChargingIcon fontSize="small" /> },
  { value: 'fueling', label: 'Fueling', icon: <FuelingIcon fontSize="small" /> },
  { value: 'cost', label: 'Cost', icon: <CostIcon fontSize="small" /> },
];

const today = () => new Date().toISOString().slice(0, 10);
const nowLocal = () => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};

const emptyForm = () => ({
  type: 'charging',
  vehicle_id: '',
  start_time: nowLocal(),
  end_time: '',
  kwh: '',
  fuel_liters: '',
  cost: '',
  source: 'manual',
  odometer: '',
  battery_level_start: '',
  battery_level_end: '',
  category: 'maintenance',
  currency: 'HUF',
  date: today(),
  notes: '',
});

/**
 * One dialog for every kind of record.
 *
 * The screen used to offer separate "Add Session" and "Add Expense" buttons with
 * two different forms, which meant deciding what kind of thing you were logging
 * before you could start. Here the type is the first field and everything else
 * follows from it.
 */
const RecordDialog = ({ open, onClose, onSaved, vehicles, editing }) => {
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);

  const isEdit = Boolean(editing);
  const isSession = form.type === 'charging' || form.type === 'fueling';

  const activeVehicles = useMemo(() => vehicles.filter((v) => !v.is_archived), [vehicles]);
  const selectedVehicle = useMemo(
    () => vehicles.find((v) => String(v.id) === String(form.vehicle_id)),
    [vehicles, form.vehicle_id],
  );
  const allowedSessionTypes = useMemo(
    () => (selectedVehicle ? getAllowedSessionTypes(selectedVehicle.fuel_type) : ['charging', 'fueling']),
    [selectedVehicle],
  );

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({ ...emptyForm(), ...editing });
    } else {
      const preferred = activeVehicles.find((v) => v.is_default) || activeVehicles[0];
      setForm({ ...emptyForm(), vehicle_id: preferred ? String(preferred.id) : '' });
    }
    setAttempted(false);
  }, [open, editing, activeVehicles]);

  // A petrol car cannot be charged; if the picked vehicle rules out the current
  // type, move to one it supports rather than failing on submit.
  useEffect(() => {
    if (!isSession || !selectedVehicle) return;
    if (!allowedSessionTypes.includes(form.type)) {
      setForm((prev) => ({ ...prev, type: allowedSessionTypes[0] || 'charging' }));
    }
  }, [allowedSessionTypes, form.type, isSession, selectedVehicle]);

  const set = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  const errors = useMemo(() => {
    const e = {};
    if (isSession) {
      if (!form.vehicle_id) e.vehicle_id = 'Pick a vehicle.';
      if (!form.start_time) e.start_time = 'When did it happen?';
      if (form.type === 'charging' && (form.kwh === '' || Number(form.kwh) <= 0)) e.kwh = 'Enter the energy added.';
      if (form.type === 'fueling' && (form.fuel_liters === '' || Number(form.fuel_liters) <= 0)) e.fuel_liters = 'Enter the amount of fuel.';
    } else if (!form.date) {
      e.date = 'Pick a date.';
    }
    if (form.cost === '' || Number(form.cost) < 0) e.cost = 'Enter the amount.';
    return e;
  }, [form, isSession]);

  const valid = Object.keys(errors).length === 0;

  const handleSubmit = async (event) => {
    event.preventDefault();
    setAttempted(true);
    if (!valid) return;

    const num = (v) => (v === '' || v === null ? null : Number(v));
    const path = isSession ? '/api/charging_sessions' : '/api/expenses';
    const body = isSession
      ? {
          vehicle_id: Number(form.vehicle_id),
          session_type: form.type,
          start_time: form.start_time,
          end_time: form.end_time || null,
          kwh: form.type === 'charging' ? num(form.kwh) : null,
          fuel_liters: form.type === 'fueling' ? num(form.fuel_liters) : null,
          cost_huf: Number(form.cost),
          source: form.source || 'manual',
          battery_level_start: num(form.battery_level_start),
          battery_level_end: num(form.battery_level_end),
          odometer: num(form.odometer),
          notes: form.notes || null,
        }
      : {
          vehicle_id: form.vehicle_id === '' ? null : Number(form.vehicle_id),
          category: form.category,
          amount: Number(form.cost),
          currency: form.currency || 'HUF',
          date: form.date,
          description: form.notes || null,
        };

    try {
      setSubmitting(true);
      const res = await apiFetch(isEdit ? `${path}/${editing.id}` : path, {
        method: isEdit ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Could not save this record');
      }
      toast.success(isEdit ? 'Record updated' : 'Record added');
      onSaved();
      onClose();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const helper = (field, fallback) => (attempted && errors[field] ? errors[field] : fallback);
  const bad = (field) => attempted && Boolean(errors[field]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEdit ? 'Edit record' : 'Add record'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                What are you logging?
              </Typography>
              <ToggleButtonGroup
                exclusive
                fullWidth
                size="small"
                value={form.type}
                onChange={(_, next) => next && setForm((prev) => ({ ...prev, type: next }))}
              >
                {RECORD_TYPES.map((option) => (
                  <ToggleButton
                    key={option.value}
                    value={option.value}
                    disabled={isEdit || (option.value !== 'cost' && selectedVehicle && !allowedSessionTypes.includes(option.value))}
                  >
                    <Stack direction="row" spacing={0.75} alignItems="center">
                      {option.icon}
                      <span>{option.label}</span>
                    </Stack>
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            <Divider />

            <TextField
              select
              label="Vehicle"
              value={form.vehicle_id}
              onChange={set('vehicle_id')}
              error={bad('vehicle_id')}
              helperText={helper('vehicle_id', isSession ? 'Required' : 'Optional — leave empty for a household cost')}
              fullWidth
            >
              {!isSession ? <MenuItem value="">No specific vehicle</MenuItem> : null}
              {activeVehicles.map((v) => (
                <MenuItem key={v.id} value={String(v.id)}>
                  {v.name || `${v.make} ${v.model}`}
                </MenuItem>
              ))}
            </TextField>

            {isSession ? (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Start" type="datetime-local" fullWidth
                    value={form.start_time} onChange={set('start_time')}
                    error={bad('start_time')} helperText={helper('start_time', ' ')}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                  <TextField
                    label="End" type="datetime-local" fullWidth
                    value={form.end_time} onChange={set('end_time')}
                    helperText="Optional"
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  {form.type === 'charging' ? (
                    <TextField
                      label="Energy (kWh)" type="number" fullWidth
                      value={form.kwh} onChange={set('kwh')}
                      error={bad('kwh')} helperText={helper('kwh', 'Required')}
                    />
                  ) : (
                    <TextField
                      label="Fuel (litres)" type="number" fullWidth
                      value={form.fuel_liters} onChange={set('fuel_liters')}
                      error={bad('fuel_liters')} helperText={helper('fuel_liters', 'Required')}
                    />
                  )}
                  <TextField
                    label="Cost (HUF)" type="number" fullWidth
                    value={form.cost} onChange={set('cost')}
                    error={bad('cost')} helperText={helper('cost', 'Required')}
                  />
                </Stack>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField label="Odometer (km)" type="number" fullWidth
                    value={form.odometer} onChange={set('odometer')} helperText="Optional" />
                  <TextField label="Source" fullWidth
                    value={form.source} onChange={set('source')} helperText="Home, Ionity, MOL…" />
                </Stack>

                {form.type === 'charging' ? (
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField label="Battery start (%)" type="number" fullWidth
                      value={form.battery_level_start} onChange={set('battery_level_start')} helperText="Optional" />
                    <TextField label="Battery end (%)" type="number" fullWidth
                      value={form.battery_level_end} onChange={set('battery_level_end')} helperText="Optional" />
                  </Stack>
                ) : null}
              </>
            ) : (
              <>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField select label="Category" fullWidth value={form.category} onChange={set('category')}>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <MenuItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label="Date" type="date" fullWidth
                    value={form.date} onChange={set('date')}
                    error={bad('date')} helperText={helper('date', ' ')}
                    slotProps={{ inputLabel: { shrink: true } }}
                  />
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <TextField
                    label="Amount" type="number" fullWidth
                    value={form.cost} onChange={set('cost')}
                    error={bad('cost')} helperText={helper('cost', 'Required')}
                  />
                  <TextField label="Currency" fullWidth value={form.currency} onChange={set('currency')} />
                </Stack>
              </>
            )}

            <TextField label="Notes" fullWidth multiline minRows={2}
              value={form.notes} onChange={set('notes')} helperText="Optional" />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={submitting || (attempted && !valid)}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

export default RecordDialog;
