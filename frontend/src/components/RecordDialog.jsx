import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Collapse,
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
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  EvStation as ChargingIcon,
  LocalGasStation as FuelingIcon,
  ReceiptLong as CostIcon,
  ExpandMore as ExpandIcon,
} from '@mui/icons-material';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { getAllowedSessionTypes } from '../utils/vehicleRules';
import { EXPENSE_CATEGORIES } from '../utils/expenseCategories';
import { useAuth } from '../context/useAuth';
import { createFormatters } from '../utils/units';
import LocationField from './LocationField';

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
  currency: '',
  date: today(),
  notes: '',
  // Optional throughout: a record with no location is exactly as valid as one with.
  latitude: null,
  longitude: null,
  location_accuracy_m: null,
  place_name: '',
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
  const { user } = useAuth();
  const fmt = useMemo(() => createFormatters(user), [user]);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [attempted, setAttempted] = useState(false);
  // The fields most records leave empty, folded away by default. Everything needed to
  // file a charge — when, how much, what it cost, where — stays in the open.
  const [showExtras, setShowExtras] = useState(false);
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));

  const isEdit = Boolean(editing);
  const isSession = form.type === 'charging' || form.type === 'fueling';

  const activeVehicles = useMemo(() => vehicles.filter((v) => !v.is_archived), [vehicles]);
  const selectedVehicle = useMemo(
    () => vehicles.find((v) => String(v.id) === String(form.vehicle_id)),
    [vehicles, form.vehicle_id],
  );
  // Hydrogen is sold by the kilogram, so the fuel field shows kg regardless of the
  // account's volume unit. The value goes in the same fuel_liters column — it is just
  // a quantity — but it is a mass, not a volume, so it is never converted to gallons.
  const isHydrogen = form.type === 'fueling' && selectedVehicle?.fuel_type === 'hydrogen';
  const fuelUnit = isHydrogen ? 'kg' : fmt.volumeShort;
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
    // Reopened for an edit, the extras may already hold values; hiding them would make
    // a filled-in field invisible, which is worse than a longer form.
    setShowExtras(Boolean(
      editing && (editing.end_time || editing.battery_level_start || editing.battery_level_end || editing.notes),
    ));
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
          cost_amount: Number(form.cost),
          source: form.source || 'manual',
          battery_level_start: num(form.battery_level_start),
          battery_level_end: num(form.battery_level_end),
          odometer: num(form.odometer),
          notes: form.notes || null,
          latitude: form.latitude,
          longitude: form.longitude,
          location_accuracy_m: form.location_accuracy_m,
          place_name: form.place_name ? form.place_name.trim() : null,
        }
      : {
          vehicle_id: form.vehicle_id === '' ? null : Number(form.vehicle_id),
          category: form.category,
          amount: Number(form.cost),
          currency: form.currency || fmt.currency,
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
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={compact}>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEdit ? 'Edit record' : 'Add record'}</DialogTitle>
        <DialogContent>
          <Stack spacing={{ xs: 1.75, sm: 2.5 }} sx={{ pt: 1 }}>
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
                <TextField
                  label="Start" type="datetime-local" fullWidth
                  value={form.start_time} onChange={set('start_time')}
                  error={bad('start_time')} helperText={helper('start_time', ' ')}
                  slotProps={{ inputLabel: { shrink: true } }}
                />

                {/* Short numeric fields pair up even on a phone. Each half is ~180px,
                    comfortably past the 44px touch minimum in both directions, and the
                    label still fits. */}
                <Stack direction="row" spacing={{ xs: 1.5, sm: 2 }}>
                  {form.type === 'charging' ? (
                    <TextField
                      label="Energy (kWh)" type="number" fullWidth
                      value={form.kwh} onChange={set('kwh')}
                      error={bad('kwh')} helperText={helper('kwh', 'Required')}
                    />
                  ) : (
                    <TextField
                      label={`Fuel (${fuelUnit})`} type="number" fullWidth
                      value={form.fuel_liters} onChange={set('fuel_liters')}
                      error={bad('fuel_liters')} helperText={helper('fuel_liters', 'Required')}
                    />
                  )}
                  <TextField
                    label={`Cost (${fmt.currency})`} type="number" fullWidth
                    value={form.cost} onChange={set('cost')}
                    error={bad('cost')} helperText={helper('cost', 'Required')}
                  />
                </Stack>

                <Stack direction="row" spacing={{ xs: 1.5, sm: 2 }}>
                  <TextField label={`Odometer (${fmt.distanceShort})`} type="number" fullWidth
                    value={form.odometer} onChange={set('odometer')} helperText="Optional" />
                  <TextField label="Source" fullWidth
                    value={form.source} onChange={set('source')} helperText="Home, Ionity, MOL…" />
                </Stack>

                <LocationField
                  value={form}
                  disabled={submitting}
                  // New records only. An edit reopens a record that already happened
                  // somewhere else, and silently restamping it with today's position
                  // would be a data loss you could not see.
                  autoLocate={!isEdit}
                  onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
                />

              </>
            ) : (
              <>
                <Stack direction="row" spacing={{ xs: 1.5, sm: 2 }}>
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
                <Stack direction="row" spacing={{ xs: 1.5, sm: 2 }}>
                  <TextField
                    label="Amount" type="number" fullWidth
                    value={form.cost} onChange={set('cost')}
                    error={bad('cost')} helperText={helper('cost', 'Required')}
                  />
                  <TextField label="Currency" fullWidth value={form.currency || fmt.currency} onChange={set('currency')} />
                </Stack>
              </>
            )}

            <Box>
              <Button
                size="small"
                onClick={() => setShowExtras((previous) => !previous)}
                endIcon={<ExpandIcon sx={{ transform: showExtras ? 'rotate(180deg)' : 'none', transition: 'transform 160ms' }} />}
                aria-expanded={showExtras}
                sx={{ color: 'text.secondary', px: 0.5 }}
              >
                {showExtras ? 'Fewer details' : 'More details'}
              </Button>
              <Collapse in={showExtras} unmountOnExit={false}>
                <Stack spacing={{ xs: 1.75, sm: 2.5 }} sx={{ pt: 1.5 }}>
                  {isSession ? (
                    <TextField
                      label="End" type="datetime-local" fullWidth
                      value={form.end_time} onChange={set('end_time')}
                      helperText="Optional"
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  ) : null}
                  {isSession && form.type === 'charging' ? (
                    <Stack direction="row" spacing={{ xs: 1.5, sm: 2 }}>
                      <TextField label="Battery start (%)" type="number" fullWidth
                        value={form.battery_level_start} onChange={set('battery_level_start')} helperText="Optional" />
                      <TextField label="Battery end (%)" type="number" fullWidth
                        value={form.battery_level_end} onChange={set('battery_level_end')} helperText="Optional" />
                    </Stack>
                  ) : null}
                  <TextField label="Notes" fullWidth multiline minRows={2}
                    value={form.notes} onChange={set('notes')} helperText="Optional" />
                </Stack>
              </Collapse>
            </Box>
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
