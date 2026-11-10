import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, Checkbox, CircularProgress, FormControlLabel, FormHelperText, Link, Stack, Tab, Tabs, TextField, Typography } from '@mui/material';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
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
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  // Server-side rejections keyed by field, e.g. a name already in use. Cleared as
  // soon as that field is edited, so the message never outlives the problem.
  const [serverErrors, setServerErrors] = useState({});
  // Set once the password checked out on an account with two-step sign-in: the
  // short-lived challenge the code step is sent with. Null on the password step.
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState('');
  const codeRef = useRef(null);
  const { login, authenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Where to go once signed in — a fleet invitation sends people here and wants them
  // back. Only a same-site path: '//host' would be a redirect to another site.
  const nextParam = searchParams.get('next') || '';
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/';
  const nextQuery = next === '/' ? '' : `?next=${encodeURIComponent(next)}`;
  const { registration_open: registrationOpen, loaded: configLoaded } = useSiteConfig();

  const usernameRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const termsRef = useRef(null);

  // Falls back to the sign-in tab when an admin has closed registration, including
  // for someone who followed a /register link. The server refuses these anyway; this
  // just avoids offering a form that cannot succeed.
  const isRegister = tab === REGISTER && registrationOpen;

  useEffect(() => {
    setTab(mode === 'register' ? REGISTER : LOGIN);
  }, [mode]);

  useEffect(() => {
    if (authenticated) navigate(next);
  }, [authenticated, navigate, next]);

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
    if (isRegister && !termsAccepted) next.terms = 'Please accept the terms to create an account.';
    return next;
  }, [isRegister, values, termsAccepted]);

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
    navigate(`${value === REGISTER ? '/register' : '/login'}${nextQuery}`);
  }, [navigate, nextQuery]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const fieldOrder = isRegister ? ['username', 'email', 'password', 'terms'] : ['email', 'password'];
    const firstInvalid = fieldOrder.find((name) => errors[name]);
    if (firstInvalid) {
      // Reveal every message at once, then put the cursor on the first problem rather
      // than leaving the user to hunt for it.
      setTouched({ username: true, email: true, password: true, terms: true });
      ({ username: usernameRef, email: emailRef, password: passwordRef, terms: termsRef })[firstInvalid].current?.focus();
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
          terms_accepted: termsAccepted,
        });
        // Straight in rather than bouncing to the sign-in form: the credentials were
        // just typed and verified, so asking for them again is pure friction.
        const session = await postJson('/api/auth/login', {
          email: values.email.trim(),
          password: values.password,
        });
        login(session.user, session.access_token);
        toast.success(`Welcome to Mileage, ${session.user.username}.`);
      } else {
        const session = await postJson('/api/auth/login', {
          email: values.email.trim(),
          password: values.password,
        });
        if (session.mfa_required) {
          setChallenge(session.mfa_token);
          setCode('');
          return;
        }
        login(session.user, session.access_token);
        toast.success(`Welcome back, ${session.user.username}.`);
      }
      navigate(next);
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

  const leaveCodeStep = () => {
    setChallenge(null);
    setCode('');
    setFormError('');
    setValues((previous) => ({ ...previous, password: '' }));
  };

  const submitCode = async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!code.trim()) {
      setFormError('Enter the code from your authenticator app.');
      codeRef.current?.focus();
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const session = await postJson('/api/auth/login/mfa', { mfa_token: challenge, code: code.trim() });
      login(session.user, session.access_token);
      toast.success(`Welcome back, ${session.user.username}.`);
      navigate(next);
    } catch (error) {
      // The challenge lasts five minutes; past that only the password step can help.
      if (/too long/i.test(error.message)) {
        leaveCodeStep();
        setFormError(error.message);
        passwordRef.current?.focus();
      } else {
        setFormError(error.message);
        setCode('');
        codeRef.current?.focus();
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (challenge) {
    return (
      <AuthLayout
        kicker="Two-step sign-in"
        title="Enter your code"
        subtitle="Open your authenticator app and type the 6-digit code it shows for Mileage."
      >
        <form onSubmit={submitCode} noValidate>
          <Stack spacing={2.25}>
            {formError ? <Alert severity="error" role="alert">{formError}</Alert> : null}
            <TextField
              fullWidth
              inputRef={codeRef}
              label="Code"
              value={code}
              onChange={(event) => { setCode(event.target.value); setFormError(''); }}
              autoComplete="one-time-code"
              autoFocus
              slotProps={{ htmlInput: { inputMode: 'text', spellCheck: false, autoCapitalize: 'none', maxLength: 32 } }}
              helperText="Lost your phone? Enter one of your recovery codes instead."
            />
            <Button
              type="submit"
              fullWidth
              variant="contained"
              disabled={submitting}
              sx={{ py: 1.5 }}
              startIcon={submitting ? <CircularProgress size={17} color="inherit" /> : null}
            >
              {submitting ? 'Checking…' : 'Sign in'}
            </Button>
            <Link component="button" type="button" underline="hover" onClick={leaveCodeStep} sx={{ alignSelf: 'center', fontWeight: 600, fontSize: '0.86rem' }}>
              Use a different account
            </Link>
          </Stack>
        </form>
      </AuthLayout>
    );
  }

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

          {isRegister ? (
            <Box>
              <FormControlLabel
                sx={{ alignItems: 'flex-start', mr: 0 }}
                control={(
                  <Checkbox
                    inputRef={termsRef}
                    checked={termsAccepted}
                    onChange={(event) => setTermsAccepted(event.target.checked)}
                    sx={{ mt: -0.75 }}
                  />
                )}
                label={(
                  <Typography variant="body2">
                    I accept the{' '}
                    <Link href="/terms" target="_blank" rel="noopener">terms of service</Link>
                    {' '}and have read the{' '}
                    <Link href="/privacy" target="_blank" rel="noopener">privacy notice</Link>.
                  </Typography>
                )}
              />
              {touched.terms && errors.terms ? <FormHelperText error>{errors.terms}</FormHelperText> : null}
            </Box>
          ) : null}

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
