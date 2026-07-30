import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  MenuItem,
  Stack,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  DirectionsCar as CarIcon,
  EvStation as ChargeIcon,
  Straighten as UnitsIcon,
} from '@mui/icons-material';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { createFormatters, guessPreferencesFromLocale } from '../utils/units';

const FUEL_TYPES = [
  { value: 'electric', label: 'Electric' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'petrol', label: 'Petrol' },
  { value: 'diesel', label: 'Diesel' },
  { value: 'hydrogen', label: 'Hydrogen' },
];

/**
 * Two questions on first sign-in, both skippable.
 *
 * Skip is a real exit, not a "remind me later": it closes onboarding for good and
 * leaves the locale-derived defaults in place. Someone who wants to get straight
 * into the product should not have to answer anything, and the settings page can
 * change all of it afterwards.
 */
const Onboarding = () => {
  const theme = useTheme();
  const { user, updateUser } = useAuth();
  const [step, setStep] = useState(0);
  const [options, setOptions] = useState(null);
  const [saving, setSaving] = useState(false);

  // Pre-filled from the browser locale so the defaults are already close, and so a
  // skip still lands somewhere sensible.
  const [units, setUnits] = useState(() => guessPreferencesFromLocale());
  const [vehicle, setVehicle] = useState({ name: '', make: '', model: '', fuel_type: 'electric' });

  useEffect(() => {
    apiFetch('/api/settings/units')
      .then((res) => (res.ok ? res.json() : null))
      .then(setOptions)
      .catch(() => {});
  }, []);

  const preview = useMemo(() => createFormatters({ ...user, ...units }), [user, units]);

  const finish = async ({ withUnits = true, withVehicle = false } = {}) => {
    setSaving(true);
    try {
      if (withVehicle && vehicle.make.trim() && vehicle.model.trim()) {
        const res = await apiFetch('/api/vehicles', {
          method: 'POST',
          body: JSON.stringify({ ...vehicle, is_default: true }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.detail || 'Could not save that vehicle');
        }
      }

      const payload = { onboarding_complete: true, ...(withUnits ? units : {}) };
      const res = await apiFetch('/api/auth/me', { method: 'PATCH', body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Could not save your settings');

      updateUser({ ...(withUnits ? units : {}), onboarded_at: new Date().toISOString() });
    } catch (error) {
      toast.error(error.message);
      setSaving(false);
    }
  };

  const canAddVehicle = vehicle.make.trim() && vehicle.model.trim();

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: { xs: 2, sm: 3 },
      }}
    >
      <Card sx={{ p: { xs: 3, sm: 4 }, borderRadius: 4, width: '100%', maxWidth: 560 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
          <Box
            sx={{
              width: 44, height: 44, borderRadius: 1.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: '1px solid', borderColor: 'primary.main',
              background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, 0.18)}, ${alpha(theme.palette.secondary.main, 0.14)})`,
            }}
          >
            <ChargeIcon sx={{ color: 'primary.main' }} />
          </Box>
          <Box>
            <Typography variant="h5" component="h1">Welcome</Typography>
            <Typography variant="body2" color="text.secondary">
              Two quick questions, or skip straight in.
            </Typography>
          </Box>
        </Stack>

        <Stepper activeStep={step} sx={{ my: 3 }}>
          <Step><StepLabel icon={<UnitsIcon fontSize="small" />}>Units</StepLabel></Step>
          <Step><StepLabel icon={<CarIcon fontSize="small" />}>Vehicle</StepLabel></Step>
        </Stepper>

        {step === 0 ? (
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              We guessed these from your browser. Change anything that looks wrong — you can
              also change it later under Account.
            </Typography>

            <TextField
              select fullWidth label="Currency" value={units.currency}
              onChange={(e) => setUnits({ ...units, currency: e.target.value })}
            >
              {(options?.currencies || []).map((c) => (
                <MenuItem key={c.code} value={c.code}>{c.code} — {c.name}</MenuItem>
              ))}
            </TextField>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select fullWidth label="Distance" value={units.distance_unit}
                onChange={(e) => setUnits({ ...units, distance_unit: e.target.value })}
              >
                {(options?.distance_units || []).map((u) => (
                  <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                select fullWidth label="Volume" value={units.volume_unit}
                onChange={(e) => setUnits({ ...units, volume_unit: e.target.value })}
              >
                {(options?.volume_units || []).map((u) => (
                  <MenuItem key={u.value} value={u.value}>{u.label}</MenuItem>
                ))}
              </TextField>
            </Stack>

            <Box sx={{ p: 1.75, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
              <Typography variant="caption" color="text.secondary">Your figures will look like</Typography>
              <Typography variant="body2" sx={{ mt: 0.5 }}>
                {preview.money(1234.5)} · {preview.distance(15000)} · {preview.volume(45)}
              </Typography>
            </Box>

            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Button color="inherit" onClick={() => finish({ withUnits: true })} disabled={saving}>
                Skip
              </Button>
              <Button variant="contained" onClick={() => setStep(1)} disabled={saving}>
                Continue
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack spacing={2.5}>
            <Typography variant="body2" color="text.secondary">
              Add the car you drive most. You can add more later, and nothing here is required.
            </Typography>

            <TextField
              label="Car name" fullWidth value={vehicle.name}
              onChange={(e) => setVehicle({ ...vehicle, name: e.target.value })}
              helperText="Optional — what you call this car, e.g. 'the red one'"
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Make" fullWidth value={vehicle.make}
                onChange={(e) => setVehicle({ ...vehicle, make: e.target.value })}
                placeholder="Toyota"
              />
              <TextField
                label="Model" fullWidth value={vehicle.model}
                onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })}
                placeholder="Prius"
              />
            </Stack>
            <TextField
              select fullWidth label="Fuel type" value={vehicle.fuel_type}
              onChange={(e) => setVehicle({ ...vehicle, fuel_type: e.target.value })}
            >
              {FUEL_TYPES.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
            </TextField>

            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Button color="inherit" onClick={() => setStep(0)} disabled={saving}>Back</Button>
              <Stack direction="row" spacing={1}>
                <Button color="inherit" onClick={() => finish({ withUnits: true })} disabled={saving}>
                  Skip
                </Button>
                <Button
                  variant="contained"
                  onClick={() => finish({ withUnits: true, withVehicle: true })}
                  disabled={saving || !canAddVehicle}
                >
                  {saving ? 'Saving…' : 'Finish'}
                </Button>
              </Stack>
            </Stack>
          </Stack>
        )}
      </Card>
    </Box>
  );
};

export default Onboarding;
