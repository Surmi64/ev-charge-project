import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';

/**
 * Where the fleet is driven, which is the input the cost forecast is most sensitive to.
 *
 * Its own card rather than a fourth row in Units & Currency: this is not a display
 * preference. Nothing on screen changes when it is saved — it changes what the
 * Analytics forecast predicts, and the copy has to say so or the control looks inert.
 *
 * The list, the descriptions and the seasonal spread all come from the backend, which
 * derives the spread from temperature normals. Hard-coding any of it here would mean
 * two places to keep in step with backend/climate.py.
 */
const ClimateSettings = () => {
  const { user, updateUser } = useAuth();
  const [zones, setZones] = useState([]);
  const [selected, setSelected] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch('/api/settings/units')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setZones(data?.climate_zones || []))
      .catch(() => toast.error('Could not load the climate zones'));
  }, []);

  useEffect(() => {
    setSelected(user?.climate_zone || '');
  }, [user]);

  const active = useMemo(
    () => zones.find((zone) => zone.value === selected) || null,
    [zones, selected],
  );

  // An account that has never answered is forecast on a temperate northern-hemisphere
  // year. That is a guess, and for a southern-hemisphere account it is an inverted one,
  // so it is stated rather than left to look like a setting nobody needs to touch.
  const unanswered = Boolean(user) && !user.climate_zone;
  const dirty = Boolean(selected) && selected !== (user?.climate_zone || '');

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ climate_zone: selected }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Could not save your climate zone');
      }
      updateUser({ climate_zone: selected });
      toast.success('Climate zone updated');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>Climate</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Cars use more energy in the cold — a battery car far more, because it has to make
        its own cabin heat. Telling us roughly where you drive lets the cost forecast
        expect that in the right months, by the right amount.
      </Typography>

      <Stack spacing={2.5}>
        {unanswered ? (
          <Alert severity="info">
            Your forecast currently assumes a temperate northern-hemisphere year. If you
            drive south of the equator, that has your seasons backwards.
          </Alert>
        ) : null}

        <TextField
          select fullWidth label="Climate zone" value={selected}
          helperText="Pick the closest match — the exact city matters much less than the shape of the year."
          onChange={(event) => setSelected(event.target.value)}
        >
          {zones.map((zone) => (
            <MenuItem key={zone.value} value={zone.value}>
              {zone.label} — {zone.example}
            </MenuItem>
          ))}
        </TextField>

        {active ? (
          <Box sx={{ p: 1.75, borderRadius: 2, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="body2">{active.description}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Seasonal swing for a battery car: about {Math.round(active.seasonal_spread * 100)}%
              more energy per kilometre in the heaviest month than the lightest.
            </Typography>
            {/* The bar is capped at the widest zone in the list so the zones are
                comparable with each other, which is the only comparison that means
                anything here — an absolute scale would have no natural maximum. */}
            <LinearProgress
              variant="determinate"
              aria-hidden
              value={Math.min(100, (active.seasonal_spread / 0.9) * 100)}
              sx={{ mt: 1, height: 6, borderRadius: 3 }}
            />
          </Box>
        ) : null}

        <Box>
          <Button variant="contained" onClick={handleSave} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save climate zone'}
          </Button>
        </Box>
      </Stack>
    </Paper>
  );
};

export default ClimateSettings;
