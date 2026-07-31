import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Collapse,
  FormControlLabel,
  InputAdornment,
  Link,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { createFormatters } from '../utils/units';

/**
 * The petrol comparison line in Analytics: on or off, and the two figures behind it.
 *
 * What is typed here wins over what the account's own fill-ups say. That is the
 * opposite of how this started, and the reason for the change is worth keeping: the
 * observed price is whatever was last paid for any fuel, so one tank of premium — or a
 * work car's diesel — would quietly become the baseline for everything. The observed
 * figure is still offered, as a suggestion that can be applied with one click.
 *
 * Both fields are entered in the account's own units and stored canonically, in litres
 * and per 100 km, the same split the rest of the app uses.
 */
const FuelComparisonSettings = () => {
  const { user, updateUser } = useAuth();
  const fmt = useMemo(() => createFormatters(user), [user]);
  const [form, setForm] = useState({ enabled: true, consumption: '', price: '' });
  const [basis, setBasis] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      enabled: user.fuel_comparison_enabled !== false,
      consumption: fmt.toConsumptionInput(user.reference_consumption_l_100km),
      price: fmt.toFuelPriceInput(user.reference_fuel_price),
    });
    // fmt is derived from user and changes with it; listing it too would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Asks the analytics endpoint what it actually used, rather than guessing here.
  useEffect(() => {
    apiFetch('/api/analytics/summary?range=ytd')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setBasis(data?.fuel_comparison || null))
      .catch(() => {});
  }, [user]);

  const observed = basis?.observed_price_per_litre ?? null;
  const dirty = Boolean(user) && (
    form.enabled !== (user.fuel_comparison_enabled !== false)
    || form.consumption !== fmt.toConsumptionInput(user.reference_consumption_l_100km)
    || form.price !== fmt.toFuelPriceInput(user.reference_fuel_price)
  );

  const handleSave = async () => {
    const body = { fuel_comparison_enabled: form.enabled };
    // Only sent when filled: an empty box means "no opinion", which falls back to the
    // observed price rather than storing a zero that would flatten the line.
    if (form.consumption !== '') body.reference_consumption_l_100km = fmt.fromConsumptionInput(form.consumption);
    if (form.price !== '') body.reference_fuel_price = fmt.fromFuelPriceInput(form.price);

    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Could not save these figures');
      }
      updateUser(body);
      const refreshed = await apiFetch('/api/analytics/summary?range=ytd')
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (refreshed) setBasis(refreshed.fuel_comparison || null);
      toast.success(form.enabled ? 'Comparison updated' : 'Comparison turned off');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>Petrol comparison</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Draws what the same distance would have cost in a petrol or diesel car, over the
        cost chart in Analytics. It compares fuel with fuel — insurance, tax and servicing
        are in neither figure, and a combustion car generally needs more of those, not less.
      </Typography>

      <FormControlLabel
        control={(
          <Switch
            checked={form.enabled}
            onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
          />
        )}
        label="Show the comparison line"
      />

      {/* Kept mounted rather than unmounted, so turning the switch off does not throw
          away what was typed before it can be saved. */}
      <Collapse in={form.enabled}>
        <Stack spacing={2.5} sx={{ pt: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth type="number" label="Fuel price"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              helperText={
                observed != null && form.price === ''
                  ? `Empty — using ${fmt.fuelPrice(observed)} from your own records`
                  : `${fmt.currency} ${fmt.fuelPriceLabel}`
              }
              slotProps={{ input: { endAdornment: <InputAdornment position="end">{fmt.fuelPriceLabel}</InputAdornment> } }}
            />
            <TextField
              fullWidth type="number" label="Consumption"
              value={form.consumption}
              onChange={(event) => setForm({ ...form, consumption: event.target.value })}
              helperText={
                form.consumption === ''
                  ? `Empty — assuming ${fmt.toConsumptionInput(7)} ${fmt.consumptionLabel}`
                  : 'What a comparable combustion car would use'
              }
              slotProps={{ input: { endAdornment: <InputAdornment position="end">{fmt.consumptionLabel}</InputAdornment> } }}
            />
          </Stack>

          {observed != null ? (
            <Alert severity="info" sx={{ py: 0 }}>
              Your own {basis.observed_fill_ups} fill-up{basis.observed_fill_ups === 1 ? '' : 's'} average{' '}
              {fmt.fuelPrice(observed)} {fmt.fuelPriceLabel}.{' '}
              <Link
                component="button" type="button" underline="always"
                onClick={() => setForm({ ...form, price: fmt.toFuelPriceInput(observed) })}
              >
                Use that
              </Link>
            </Alert>
          ) : null}

          {basis && !basis.available && basis.enabled !== false ? (
            <Alert severity="warning" sx={{ py: 0 }}>
              No line is drawn yet: there is no fuel price to work from. Enter one above —
              nothing is assumed for you, because fuel costs differ far too much between
              countries for a guess to mean anything.
            </Alert>
          ) : null}
        </Stack>
      </Collapse>

      <Box sx={{ mt: 2.5 }}>
        <Button variant="contained" onClick={handleSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save comparison'}
        </Button>
      </Box>
    </Paper>
  );
};

export default FuelComparisonSettings;
