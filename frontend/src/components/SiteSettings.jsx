import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  FormControlLabel,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useDelayedLoading } from '../utils/useDelayedLoading';
import { TableSectionSkeleton } from './SectionSkeletons';


const NOTICE_MAX = 280;

/**
 * Instance-wide settings, as opposed to the per-account preferences on Account.
 *
 * Each setting falls back to the deployed environment value when no admin has chosen
 * one, so the panel shows an "inherited" marker rather than pretending the displayed
 * number was configured here. Saving sends only what actually changed.
 */
const SiteSettings = () => {
  const [settings, setSettings] = useState(null);
  // Fetched rather than duplicated: /settings/units is already the single source of
  // the currency list, as its own docstring says.
  const [currencies, setCurrencies] = useState([]);
  const [defaults, setDefaults] = useState({});
  const [draft, setDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const showSkeleton = useDelayedLoading(loading);

  const load = useCallback(async () => {
    try {
      const [res, unitsRes] = await Promise.all([
        apiFetch('/api/admin/site-settings'),
        apiFetch('/api/settings/units'),
      ]);
      if (unitsRes.ok) setCurrencies((await unitsRes.json()).currencies || []);
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || 'Could not load site settings');
      }
      const data = await res.json();
      setSettings(data.settings);
      setDraft(data.settings);
      setDefaults(data.defaults || {});
      setErrorMessage('');
    } catch (error) {
      setErrorMessage(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const changed = useMemo(() => {
    if (!settings || !draft) return {};
    return Object.fromEntries(
      Object.entries(draft).filter(([key, value]) => value !== settings[key]),
    );
  }, [settings, draft]);
  const hasChanges = Object.keys(changed).length > 0;

  const setValue = (key) => (value) => setDraft((previous) => ({ ...previous, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch('/api/admin/site-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: changed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not save site settings');
      setSettings(payload.settings);
      setDraft(payload.settings);
      toast.success('Site settings saved');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  // Marks a value that matches what the deployment would fall back to. It compares
  // values, so it cannot tell "never set" from "set to exactly the default" — the
  // chip therefore reads "default", not "unset".
  const inherited = (key) => settings?.[key] === defaults?.[key];

  if (showSkeleton) return <TableSectionSkeleton />;
  if (loading) return null;
  if (errorMessage) return <Alert severity="error" role="alert">{errorMessage}</Alert>;

  return (
    <Stack spacing={2.5}>
      <Paper sx={{ p: 2.5, borderRadius: 4 }}>
        <Typography variant="h6" fontWeight={700}>Access</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Applies to everyone on this instance. Existing accounts keep working either way.
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={Boolean(draft.registration_open)}
              onChange={(event) => setValue('registration_open')(event.target.checked)}
            />
          }
          label={
            <Box>
              <Typography variant="body2" fontWeight={600}>
                Open registration
                {inherited('registration_open') ? <Chip size="small" label="default" variant="outlined" sx={{ ml: 1, height: 19 }} /> : null}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {draft.registration_open
                  ? 'Anyone can create an account.'
                  : 'The sign-up form is hidden and the API refuses new accounts.'}
              </Typography>
            </Box>
          }
          sx={{ alignItems: 'flex-start', ml: 0, gap: 1.5 }}
        />
      </Paper>

      <Paper sx={{ p: 2.5, borderRadius: 4 }}>
        <Typography variant="h6" fontWeight={700}>New accounts</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          Applied when an account is created. Changing these leaves existing accounts alone.
        </Typography>

        <Stack spacing={2.5} direction={{ xs: 'column', sm: 'row' }}>
          <TextField
            label="Trial length"
            type="number"
            value={draft.trial_days}
            onChange={(event) => setValue('trial_days')(Number(event.target.value))}
            slotProps={{ htmlInput: { min: 0, max: 365 } }}
            helperText={inherited('trial_days') ? 'Deployment default' : 'Days before a new account must subscribe'}
            sx={{ maxWidth: { sm: 220 } }}
          />
          <TextField
            select
            label="Default currency"
            value={draft.default_currency}
            onChange={(event) => setValue('default_currency')(event.target.value)}
            helperText={inherited('default_currency') ? 'Deployment default' : 'Shown until the account changes it'}
            sx={{ minWidth: 220 }}
          >
            {currencies.map((currency) => (
              <MenuItem key={currency.code} value={currency.code}>
                {currency.code} — {currency.name}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2.5, borderRadius: 4 }}>
        <Typography variant="h6" fontWeight={700}>Maintenance notice</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Shown on the sign-in screen. Leave empty to show nothing.
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={2}
          value={draft.maintenance_notice}
          onChange={(event) => setValue('maintenance_notice')(event.target.value.slice(0, NOTICE_MAX))}
          placeholder="Scheduled maintenance on Sunday 02:00–04:00 CET."
          helperText={`${draft.maintenance_notice.length} / ${NOTICE_MAX}`}
        />
      </Paper>

      <Divider />

      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          onClick={save}
          disabled={!hasChanges || saving}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        <Button variant="text" onClick={() => setDraft(settings)} disabled={!hasChanges || saving}>
          Discard
        </Button>
        <Typography variant="caption" color="text.secondary">
          {hasChanges
            ? `${Object.keys(changed).length} unsaved change${Object.keys(changed).length === 1 ? '' : 's'}`
            : 'No unsaved changes'}
        </Typography>
      </Box>
    </Stack>
  );
};

export default SiteSettings;
