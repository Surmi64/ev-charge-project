import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  MenuItem,
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
 * Units and currency for the account.
 *
 * Distance and volume are conversions over canonical storage, so changing them
 * restates everything consistently. Currency is only a label — see the warning
 * below, which is shown rather than hidden because silently relabelling a history
 * of forint amounts as euros would misrepresent what the user actually spent.
 */
const UnitSettings = () => {
  const { user, updateUser } = useAuth();
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState({ currency: 'EUR', distance_unit: 'km', volume_unit: 'l' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings/units')
      .then((res) => (res.ok ? res.json() : null))
      .then(setOptions)
      .catch(() => toast.error('Could not load the unit options'));
  }, []);

  useEffect(() => {
    if (!user) return;
    setForm({
      currency: user.currency || 'EUR',
      distance_unit: user.distance_unit || 'km',
      volume_unit: user.volume_unit || 'l',
    });
  }, [user]);

  const currencyChanged = user && form.currency !== (user.currency || 'EUR');
  const dirty = user && (
    currencyChanged
    || form.distance_unit !== (user.distance_unit || 'km')
    || form.volume_unit !== (user.volume_unit || 'l')
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify(form) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Could not save your settings');
      }
      updateUser(form);
      toast.success('Units updated');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  // Preview with the pending selection, not the saved one, so the effect is visible
  // before committing to it.
  const preview = createFormatters({ ...user, ...form });

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>Units &amp; Currency</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        How figures are shown across the app.
      </Typography>

      <Stack spacing={2.5}>
        <TextField
          select fullWidth label="Currency" value={form.currency}
          onChange={(e) => setForm({ ...form, currency: e.target.value })}
        >
          {(options?.currencies || []).map((c) => (
            <MenuItem key={c.code} value={c.code}>
              {c.code} — {c.name}
            </MenuItem>
          ))}
        </TextField>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            select fullWidth label="Distance" value={form.distance_unit}
            onChange={(e) => setForm({ ...form, distance_unit: e.target.value })}
          >
            {(options?.distance_units || []).map((u) => (
              <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select fullWidth label="Volume" value={form.volume_unit}
            onChange={(e) => setForm({ ...form, volume_unit: e.target.value })}
          >
            {(options?.volume_units || []).map((u) => (
              <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
            ))}
          </TextField>
        </Stack>

        <Box sx={{ p: 1.75, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary">Preview</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {preview.money(1234.5)} · {preview.distance(15000)} · {preview.volume(45)} · {preview.energy(58)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Running cost {preview.moneyPerHundred(1800)} {preview.perDistanceLabel}
          </Typography>
        </Box>

        {currencyChanged ? (
          <Alert severity="warning">
            Changing the currency relabels your figures — it does not convert them.
            Entries you already recorded keep their original amounts, because converting
            them would need the exchange rate on each entry&apos;s own date.
            Distance and volume do convert, since those are exact.
          </Alert>
        ) : null}

        <Box>
          <Button variant="contained" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save units'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
};

export default UnitSettings;
