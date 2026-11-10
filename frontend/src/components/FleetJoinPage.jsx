import React, { useEffect, useState } from 'react';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { FLEET_ROLES } from '../utils/fleet';

/**
 * Landing page for a fleet invitation link.
 *
 * Public, outside the signed-in shell: the invitee may not have an account yet. The
 * preview needs only the token. Signing in or registering comes back here through
 * `?next=`, and accepting is an explicit click — never automatic on load, so opening a
 * link does not silently put an account into someone's fleet.
 */
const FleetJoinPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { authenticated, loading, account, switchWorkspace } = useAuth();
  const token = searchParams.get('token') || '';
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    fetch(`/api/fleet/invitations/preview?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.detail || 'This invitation is no longer valid.');
        setPreview(data);
      })
      .catch((failure) => setError(failure.message));
  }, [token]);

  const here = `/fleet/join?token=${encodeURIComponent(token)}`;

  const join = async () => {
    setJoining(true);
    try {
      const res = await apiFetch('/api/fleet/invitations/accept', { method: 'POST', body: JSON.stringify({ token }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || 'Could not join the fleet.');
      switchWorkspace(data.owner_id);
    } catch (failure) {
      setError(failure.message);
      setJoining(false);
    }
  };

  const role = preview ? FLEET_ROLES[preview.role] : null;
  const otherAddress = preview && account && account.email.toLowerCase() !== preview.email.toLowerCase();

  return (
    <AuthLayout kicker="Fleet invitation" title={preview ? `Join ${preview.owner_name}'s fleet` : error ? 'Invitation not valid' : 'Invitation'}>
      <Stack spacing={2}>
        {!preview && !error ? <CircularProgress size={28} /> : null}
        {error ? <Alert severity="warning">{error}</Alert> : null}
        {preview ? (
          <>
            <Typography color="text.secondary">
              {preview.owner_name} invited <strong>{preview.email}</strong> as a {role.label.toLowerCase()}
              {preview.role === 'driver' && preview.vehicle_count
                ? ` for ${preview.vehicle_count} vehicle${preview.vehicle_count === 1 ? '' : 's'}` : ''}.
              {' '}{role.invitee}
              {preview.role === 'driver' && !preview.vehicle_count ? ' The owner assigns your vehicles after you join.' : ''}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              You keep your own account and can switch between it and the fleet at any time. The fleet&apos;s plan covers
              what you record there.
            </Typography>
            {loading ? null : authenticated ? (
              <>
                {otherAddress ? (
                  <Alert severity="info" variant="outlined">
                    You are signed in as {account.email}. Joining adds this account to the fleet.
                  </Alert>
                ) : null}
                <Button variant="contained" disabled={joining} onClick={join}>
                  {joining ? 'Joining…' : `Join as ${account.username}`}
                </Button>
              </>
            ) : (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button variant="contained" onClick={() => navigate(`/login?next=${encodeURIComponent(here)}`)}>Sign in to join</Button>
                <Button onClick={() => navigate(`/register?next=${encodeURIComponent(here)}`)}>Create an account</Button>
              </Stack>
            )}
          </>
        ) : null}
        {error ? <Button onClick={() => navigate(authenticated ? '/' : '/login')}>{authenticated ? 'Continue to Mileage' : 'Sign in'}</Button> : null}
      </Stack>
    </AuthLayout>
  );
};

export default FleetJoinPage;
