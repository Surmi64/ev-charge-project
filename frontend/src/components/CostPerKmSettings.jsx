import React, { useState } from 'react';
import { FormControlLabel, Paper, Switch, Typography } from '@mui/material';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';

/**
 * Whether cost per 100 km counts every cost or only charging and fuel.
 *
 * Off by default. Insurance, tax and servicing are paid on a calendar rather than per
 * kilometre, so counting them turned whichever month a quarterly bill landed in into
 * the most expensive driving of the year. Saved as soon as it is flipped: it is one
 * switch, and a save button for it would only be a second click.
 */
const CostPerKmSettings = () => {
  const { user, updateUser } = useAuth();
  const [saving, setSaving] = useState(false);
  const checked = Boolean(user?.cost_per_km_includes_expenses);

  const handleChange = async (event) => {
    const next = event.target.checked;
    setSaving(true);
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ cost_per_km_includes_expenses: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Could not save this setting');
      }
      updateUser({ cost_per_km_includes_expenses: next });
      toast.success(next ? 'Cost per distance now counts every cost' : 'Cost per distance now counts charging and fuel only');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>Cost per distance</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        By default it counts what you spend on charging and fuel. Insurance, tax and
        servicing are paid on a calendar, not per kilometre — counted in, one insurance
        bill makes its month look like the most expensive driving of the year. Totals
        always include every cost either way.
      </Typography>
      <FormControlLabel
        control={<Switch checked={checked} onChange={handleChange} disabled={saving} />}
        label="Include insurance, tax, servicing and other costs"
      />
    </Paper>
  );
};

export default CostPerKmSettings;
