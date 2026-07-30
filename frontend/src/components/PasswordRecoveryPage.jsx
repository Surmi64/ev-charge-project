import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Link,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { ContentCopyOutlined as CopyIcon } from '@mui/icons-material';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import AuthLayout from './AuthLayout';
import PasswordField from './PasswordField';
import { isPasswordValid, isValidEmail } from '../utils/passwordPolicy';

const postJson = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Something went wrong. Please try again.');
  return data;
};

function PasswordRecoveryPage({ mode = 'forgot' }) {
  const { authenticated } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isForgot = mode === 'forgot';

  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState(searchParams.get('token') || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [requested, setRequested] = useState(false);
  const [devToken, setDevToken] = useState('');
  const [devExpiry, setDevExpiry] = useState('');

  const emailRef = useRef(null);
  const tokenRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmRef = useRef(null);

  useEffect(() => {
    if (authenticated) navigate('/');
  }, [authenticated, navigate]);

  useEffect(() => {
    setResetToken(searchParams.get('token') || '');
  }, [searchParams]);

  const errors = useMemo(() => {
    const next = {};
    if (isForgot) {
      if (!email.trim()) next.email = 'Email address is required.';
      else if (!isValidEmail(email)) next.email = 'That does not look like an email address.';
      return next;
    }
    if (!resetToken.trim()) next.token = 'Paste the reset token from your email.';
    if (!newPassword) next.password = 'Choose a new password.';
    else if (!isPasswordValid(newPassword)) next.password = 'Password does not meet all the requirements below.';
    if (!confirmPassword) next.confirm = 'Please repeat the password.';
    else if (confirmPassword !== newPassword) next.confirm = 'The two passwords do not match.';
    return next;
  }, [isForgot, email, resetToken, newPassword, confirmPassword]);

  const markTouched = (name) => () => setTouched((previous) => ({ ...previous, [name]: true }));
  const showError = (name) => (touched[name] ? errors[name] : undefined);

  const focusFirstInvalid = (order) => {
    const refs = { email: emailRef, token: tokenRef, password: passwordRef, confirm: confirmRef };
    const first = order.find((name) => errors[name]);
    if (!first) return false;
    setTouched({ email: true, token: true, password: true, confirm: true });
    refs[first].current?.focus();
    return true;
  };

  const handleForgot = async (event) => {
    event.preventDefault();
    if (submitting || focusFirstInvalid(['email'])) return;

    setSubmitting(true);
    setFormError('');
    try {
      const data = await postJson('/api/auth/forgot-password', { email: email.trim() });
      // The server answers the same way whether or not the address exists, so the
      // screen must not imply an account was found either.
      setRequested(true);
      setDevToken(data.reset_token || '');
      setDevExpiry(data.expires_at || '');
    } catch (error) {
      setFormError(error.message);
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (event) => {
    event.preventDefault();
    if (submitting || focusFirstInvalid(['token', 'password', 'confirm'])) return;

    setSubmitting(true);
    setFormError('');
    try {
      await postJson('/api/auth/reset-password', {
        reset_token: resetToken.trim(),
        new_password: newPassword,
      });
      toast.success('Password updated. Sign in with your new password.');
      navigate('/login');
    } catch (error) {
      setFormError(error.message);
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const backToSignIn = (
    <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
      <Link component="button" type="button" underline="hover" onClick={() => navigate('/login')} sx={{ fontWeight: 600, fontSize: '0.86rem' }}>
        Back to sign in
      </Link>
      <Typography variant="caption" color="text.disabled" aria-hidden="true">·</Typography>
      <Link component="button" type="button" underline="hover" onClick={() => navigate(isForgot ? '/register' : '/forgot-password')} sx={{ fontWeight: 600, fontSize: '0.86rem' }}>
        {isForgot ? 'Create an account' : 'Request a new token'}
      </Link>
    </Box>
  );

  if (isForgot && requested) {
    return (
      <AuthLayout
        kicker="Check your inbox"
        title="Reset requested"
        subtitle={`If an account exists for ${email.trim()}, a reset token is on its way. The token expires shortly, so use it soon.`}
        footer={backToSignIn}
      >
        <Stack spacing={2.25}>
          {devToken ? (
            <Alert severity="info" sx={{ '& .MuiAlert-message': { width: '100%', minWidth: 0 } }}>
              <AlertTitle sx={{ fontWeight: 700 }}>Development mode</AlertTitle>
              <Typography variant="body2" sx={{ mb: 1 }}>
                No mail is sent outside production, so the token is shown here instead.
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <Typography
                  variant="body2"
                  sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flexGrow: 1, minWidth: 0 }}
                >
                  {devToken}
                </Typography>
                <Tooltip title="Copy token">
                  <IconButton
                    size="small"
                    aria-label="Copy reset token"
                    onClick={() => {
                      navigator.clipboard?.writeText(devToken);
                      toast.success('Token copied');
                    }}
                  >
                    <CopyIcon fontSize="inherit" />
                  </IconButton>
                </Tooltip>
              </Box>
              {devExpiry ? (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Expires {new Date(devExpiry).toLocaleString()}
                </Typography>
              ) : null}
            </Alert>
          ) : null}

          <Button
            fullWidth
            variant="contained"
            sx={{ py: 1.5 }}
            onClick={() => navigate(devToken ? `/reset-password?token=${encodeURIComponent(devToken)}` : '/reset-password')}
          >
            Continue to set a new password
          </Button>
          <Button
            fullWidth
            variant="text"
            onClick={() => { setRequested(false); setDevToken(''); setDevExpiry(''); }}
          >
            Use a different email
          </Button>
        </Stack>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      kicker={isForgot ? 'Account recovery' : 'Almost done'}
      title={isForgot ? 'Forgot your password?' : 'Set a new password'}
      subtitle={
        isForgot
          ? 'Enter the email you signed up with and we will send a reset token.'
          : 'Paste the token you were sent, then choose a password you have not used here before.'
      }
      footer={backToSignIn}
    >
      <form onSubmit={isForgot ? handleForgot : handleReset} noValidate>
        <Stack spacing={2.25}>
          {formError ? <Alert severity="error" role="alert">{formError}</Alert> : null}

          {isForgot ? (
            <TextField
              fullWidth
              required
              inputRef={emailRef}
              label="Email"
              type="email"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setFormError(''); }}
              onBlur={markTouched('email')}
              error={Boolean(showError('email'))}
              helperText={showError('email')}
              autoComplete="email"
              autoFocus
            />
          ) : (
            <>
              <TextField
                fullWidth
                required
                inputRef={tokenRef}
                label="Reset token"
                value={resetToken}
                onChange={(event) => { setResetToken(event.target.value); setFormError(''); }}
                onBlur={markTouched('token')}
                error={Boolean(showError('token'))}
                helperText={showError('token') || 'Copied from the reset email.'}
                autoComplete="one-time-code"
                slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
                autoFocus={!resetToken}
              />
              <PasswordField
                inputRef={passwordRef}
                label="New password"
                value={newPassword}
                onChange={(event) => { setNewPassword(event.target.value); setFormError(''); }}
                onBlur={markTouched('password')}
                error={showError('password')}
                autoComplete="new-password"
                showPolicy
                autoFocus={Boolean(resetToken)}
              />
              <PasswordField
                inputRef={confirmRef}
                label="Repeat new password"
                value={confirmPassword}
                onChange={(event) => { setConfirmPassword(event.target.value); setFormError(''); }}
                onBlur={markTouched('confirm')}
                error={showError('confirm')}
                autoComplete="new-password"
              />
            </>
          )}

          <Button
            type="submit"
            fullWidth
            variant="contained"
            disabled={submitting}
            sx={{ py: 1.5, mt: 0.5 }}
            startIcon={submitting ? <CircularProgress size={17} color="inherit" /> : null}
          >
            {submitting
              ? (isForgot ? 'Sending…' : 'Updating…')
              : (isForgot ? 'Send reset token' : 'Update password')}
          </Button>
        </Stack>
      </form>
    </AuthLayout>
  );
}

export default PasswordRecoveryPage;
