import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { createFormatters } from '../utils/units';

/**
 * The two figures behind the "what would petrol have cost" line in Analytics.
 *
 * Both are entered in the account's own units and stored canonically — litres and
 * per-100-km — the same split the rest of the app uses. Neither is defaulted into the
 * database: an unanswered fuel price means the comparison is not drawn at all, which
 * is the honest outcome when the number would otherwise be invented. Fuel costs differ
 * by more than tenfold across the currencies this app supports.
 *
 * The price field is only asked for when the account has no fuelling records of its
 * own. If it has any, the server averages those instead and says so — a real price
 * beats a remembered one.
 */
const FuelComparisonSettings = () => {
  const { user, updateUser } = useAuth();
  const fmt = useMemo(() => createFormatters(user), [user]);
  const [form, setForm] = useState({ consumption: '', price: '' });
  const [basis, setBasis] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setForm({
      consumption: fmt.toConsumptionInput(user.reference_consumption_l_100km),
      price: fmt.toFuelPriceInput(user.reference_fuel_price),
    });
    // fmt is derived from user, so it changes with it; listing it too would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Asks the analytics endpoint what it actually used, rather than guessing here.
  useEffect(() => {
    apiFetch('/api/analytics/summary?range=ytd')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setBasis(data?.fuel_comparison || null))
      .catch(() => {});
  }, [user]);

  const usesOwnPrice = basis?.fuel_price_source === 'observed';

  const handleSave = async () => {
    const body = {};
    if (form.consumption !== '') body.reference_consumption_l_100km = fmt.fromConsumptionInput(form.consumption);
    if (form.price !== '') body.reference_fuel_price = fmt.fromFuelPriceInput(form.price);
    if (!Object.keys(body).length) return;

    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Could not save these figures');
      }
      updateUser(body);
      toast.success('Comparison updated');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>Petrol comparison</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Analytics can draw what the same distance would have cost in a petrol or diesel
        car. It compares fuel with fuel — insurance, tax and servicing are not in either
        figure, and a combustion car generally needs more of those, not less.
      </Typography>

      <Stack spacing={2.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            fullWidth type="number" label="Reference consumption"
            value={form.consumption}
            onChange={(event) => setForm({ ...form, consumption: event.target.value })}
            helperText={
              basis?.consumption_source === 'default' && form.consumption === ''
                ? `Assuming ${fmt.toConsumptionInput(basis.consumption_l_100km)} until you say otherwise`
                : 'What a comparable combustion car would use'
            }
            slotProps={{ input: { endAdornment: <InputAdornment position="end">{fmt.consumptionLabel}</InputAdornment> } }}
          />
          <TextField
            fullWidth type="number" label="Fuel price"
            value={form.price}
            onChange={(event) => setForm({ ...form, price: event.target.value })}
            disabled={usesOwnPrice}
            helperText={
              usesOwnPrice
                ? `Taken from your own ${basis.observed_fill_ups} fill-up${basis.observed_fill_ups === 1 ? '' : 's'}`
                : `${fmt.currency} ${fmt.fuelPriceLabel}`
            }
            slotProps={{ input: { endAdornment: <InputAdornment position="end">{fmt.fuelPriceLabel}</InputAdornment> } }}
          />
        </Stack>

        {usesOwnPrice ? (
          <Alert severity="success" sx={{ py: 0 }}>
            Using {fmt.fuelPrice(basis.fuel_price_per_litre)} {fmt.fuelPriceLabel}, averaged over
            what you actually paid. A price you have paid beats one you have to remember,
            so this overrides the field above.
          </Alert>
        ) : basis && !basis.available ? (
          <Alert severity="info" sx={{ py: 0 }}>
            No comparison line yet — enter a fuel price and it will appear in Analytics.
            Nothing is assumed for you, because fuel costs differ far too much between
            countries for a guess to mean anything.
          </Alert>
        ) : null}

        <Box>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save comparison'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
};

export default FuelComparisonSettings;
