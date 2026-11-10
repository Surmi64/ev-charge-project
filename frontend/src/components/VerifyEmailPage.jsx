import React, { useEffect, useRef, useState } from 'react';
import { Alert, Button, CircularProgress, Stack } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AuthLayout from './AuthLayout';
import { useAuth } from '../context/useAuth';

/**
 * Landing page for the link in the confirmation email.
 *
 * Plain fetch, not apiFetch: the link works whether or not anyone is signed in on
 * this browser, and the token is the only credential it needs. Posted once — a ref
 * guards against StrictMode's double effect spending the one-time token twice and
 * then reporting the second, refused call as the outcome.
 */
const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { authenticated, updateUser } = useAuth();
  const [state, setState] = useState({ status: 'working', message: '' });
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    const token = searchParams.get('token') || '';
    fetch('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.detail || 'This link could not be used.');
        if (authenticated) updateUser({ email_verified_at: new Date().toISOString() });
        setState({ status: 'done', message: `${data.email} is confirmed.` });
      })
      .catch((error) => setState({ status: 'failed', message: error.message }));
  }, [searchParams, authenticated, updateUser]);

  return (
    <AuthLayout
      kicker="Email address"
      title={state.status === 'done' ? 'Address confirmed' : state.status === 'failed' ? 'Link not valid' : 'Confirming…'}
    >
      <Stack spacing={2}>
        {state.status === 'working' ? <CircularProgress size={28} /> : null}
        {state.status === 'done' ? <Alert severity="success">{state.message}</Alert> : null}
        {state.status === 'failed' ? <Alert severity="warning">{state.message}</Alert> : null}
        {state.status !== 'working' ? (
          <Button variant="contained" onClick={() => navigate(authenticated ? '/' : '/login')}>
            {authenticated ? 'Continue to Mileage' : 'Sign in'}
          </Button>
        ) : null}
      </Stack>
    </AuthLayout>
  );
};

export default VerifyEmailPage;
