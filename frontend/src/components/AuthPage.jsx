import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Link, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import AuthLayout from './AuthLayout';
import PasswordField from './PasswordField';
import { isPasswordValid, isValidEmail } from '../utils/passwordPolicy';
import { useSiteConfig } from '../utils/useSiteConfig';

const LOGIN = 0;
const REGISTER = 1;

// Raw fetch rather than utils/api's apiFetch, which is otherwise the only way to call
// the API. apiFetch attaches the stored token and retries through a refresh on 401 —
// on this page a 401 means "wrong password", and treating it as an expired session
// would fire a pointless refresh and sign out whoever was already logged in.
const postJson = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.detail || data.error || 'Something went wrong. Please try again.');
    // Registration conflicts name the colliding field, so the message can sit under
    // the input the user has to change rather than only at the top of the form.
    error.field = data.field || null;
    throw error;
  }
  return data;
};

const AuthPage = ({ mode = 'login' }) => {
  const [tab, setTab] = useState(mode === 'register' ? REGISTER : LOGIN);
  const [values, setValues] = useState({ username: '', email: '', password: '' });
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  // Server-side rejections keyed by field, e.g. a name already in use. Cleared as
  // soon as that field is edited, so the message never outlives the problem.
  const [serverErrors, setServerErrors] = useState({});
  const { login, authenticated } = useAuth();
  const navigate = useNavigate();
  const { registration_open: registrationOpen, loaded: configLoaded } = useSiteConfig();

  const usernameRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);

  // Falls back to the sign-in tab when an admin has closed registration, including
  // for someone who followed a /register link. The server refuses these anyway; this
  // just avoids offering a form that cannot succeed.
  const isRegister = tab === REGISTER && registrationOpen;

  useEffect(() => {
    setTab(mode === 'register' ? REGISTER : LOGIN);
  }, [mode]);

  useEffect(() => {
    if (authenticated) navigate('/');
  }, [authenticated, navigate]);

  // Field-level messages. Registration holds the password to the server's policy;
  // signing in only checks that something was typed, because an existing password
  // predates whatever the policy says today and rejecting it here would lock the
  // account out of its own login form.
  const errors = useMemo(() => {
    const next = {};
    if (isRegister && values.username.trim().length < 2) {
      next.username = 'Please enter a name of at least 2 characters.';
    }
    if (!values.email.trim()) next.email = 'Email address is required.';
    else if (!isValidEmail(values.email)) next.email = 'That does not look like an email address.';

    if (!values.password) next.password = 'Password is required.';
    else if (isRegister && !isPasswordValid(values.password)) {
      next.password = 'Password does not meet all the requirements below.';
    }
    return next;
  }, [isRegister, values]);

  const setField = (name) => (event) => {
    setValues((previous) => ({ ...previous, [name]: event.target.value }));
    setFormError('');
    setServerErrors((previous) => (previous[name] ? { ...previous, [name]: undefined } : previous));
  };
  const markTouched = (name) => () => setTouched((previous) => ({ ...previous, [name]: true }));
  const showError = (name) => serverErrors[name] || (touched[name] ? errors[name] : undefined);

  const switchTab = useCallback((_event, value) => {
    setTab(value);
    setTouched({});
    setFormError('');
    setServerErrors({});
    setValues((previous) => ({ ...previous, password: '' }));
    navigate(value === REGISTER ? '/register' : '/login');
  }, [navigate]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const fieldOrder = isRegister ? ['username', 'email', 'password'] : ['email', 'password'];
    const firstInvalid = fieldOrder.find((name) => errors[name]);
    if (firstInvalid) {
      // Reveal every message at once, then put the cursor on the first problem rather
      // than leaving the user to hunt for it.
      setTouched({ username: true, email: true, password: true });
      ({ username: usernameRef, email: emailRef, password: passwordRef })[firstInvalid].current?.focus();
      return;
    }

    setSubmitting(true);
    setFormError('');
    setServerErrors({});
    try {
      if (isRegister) {
        await postJson('/api/auth/register', {
          username: values.username.trim(),
          email: values.email.trim(),
          password: values.password,
        });
        // Straight in rather than bouncing to the sign-in form: the credentials were
        // just typed and verified, so asking for them again is pure friction.
        const session = await postJson('/api/auth/login', {
          email: values.email.trim(),
          password: values.password,
        });
        login(session.user, session.access_token, session.refresh_token);
        toast.success(`Welcome to Mileage, ${session.user.username}.`);
      } else {
        const session = await postJson('/api/auth/login', {
          email: values.email.trim(),
          password: values.password,
        });
        login(session.user, session.access_token, session.refresh_token);
        toast.success(`Welcome back, ${session.user.username}.`);
      }
      navigate('/');
    } catch (error) {
      toast.error(error.message);
      if (error.field && ['username', 'email'].includes(error.field)) {
        setServerErrors({ [error.field]: error.message });
        ({ username: usernameRef, email: emailRef })[error.field].current?.focus();
      } else {
        setFormError(error.message);
        passwordRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      kicker={isRegister ? 'Get started' : 'Welcome back'}
      title={isRegister ? 'Create your account' : 'Sign in'}
      subtitle={
        isRegister
          ? 'Thirty days free, no card needed. You can add your first vehicle straight after.'
          : 'Enter your email and password to reach your fleet.'
      }
      footer={
        isRegister ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
            No card required. Your trial simply stops, it does not charge you.
          </Typography>
        ) : null
      }
    >
      {registrationOpen ? (
        <Tabs
          value={isRegister ? REGISTER : LOGIN}
          onChange={switchTab}
          variant="fullWidth"
          sx={{ mb: 3 }}
          aria-label="Sign in or create an account"
        >
          <Tab label="Sign in" id="auth-tab-login" value={LOGIN} />
          <Tab label="Create account" id="auth-tab-register" value={REGISTER} />
        </Tabs>
      ) : configLoaded ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          New registrations are closed at the moment. Existing accounts sign in as usual.
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit} noValidate>
        <Stack spacing={2.25}>
          {formError ? (
            // role=alert so the failure is announced; the toast alone is easy to miss
            // and disappears before a screen reader may reach it.
            <Alert severity="error" role="alert">{formError}</Alert>
          ) : null}

          {isRegister ? (
            <TextField
              fullWidth
              required
              inputRef={usernameRef}
              label="Your name"
              value={values.username}
              onChange={setField('username')}
              onBlur={markTouched('username')}
              error={Boolean(showError('username'))}
              helperText={showError('username') || 'Shown in the app, and unique across accounts.'}
              autoComplete="name"
              autoFocus
            />
          ) : null}

          <TextField
            fullWidth
            required
            inputRef={emailRef}
            label="Email"
            type="email"
            value={values.email}
            onChange={setField('email')}
            onBlur={markTouched('email')}
            error={Boolean(showError('email'))}
            helperText={showError('email')}
            autoComplete="email"
            autoFocus={!isRegister}
          />

          <PasswordField
            inputRef={passwordRef}
            label="Password"
            value={values.password}
            onChange={setField('password')}
            onBlur={markTouched('password')}
            error={showError('password')}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            showPolicy={isRegister}
          />

          {!isRegister ? (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -0.5 }}>
              <Link
                component="button"
                type="button"
                underline="hover"
                onClick={() => navigate('/forgot-password')}
                sx={{ fontWeight: 600, fontSize: '0.86rem' }}
              >
                Forgot your password?
              </Link>
            </Box>
          ) : null}

          <Button
            type="submit"
            fullWidth
            variant="contained"
            disabled={submitting}
            sx={{ py: 1.5, mt: 0.5 }}
            startIcon={submitting ? <CircularProgress size={17} color="inherit" /> : null}
          >
            {submitting
              ? (isRegister ? 'Creating account…' : 'Signing in…')
              : (isRegister ? 'Create account' : 'Sign in')}
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
};

export default AuthPage;
