import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  Link,
  Paper,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { toast } from 'sonner';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

function PasswordRecoveryPage({ mode = 'forgot' }) {
  const { authenticated } = useAuth();
  const theme = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState('');
  const [resetToken, setResetToken] = useState(searchParams.get('token') || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [devResetToken, setDevResetToken] = useState('');
  const [devResetExpiry, setDevResetExpiry] = useState('');

  useEffect(() => {
    if (authenticated) {
      navigate('/');
    }
  }, [authenticated, navigate]);

  useEffect(() => {
    setResetToken(searchParams.get('token') || '');
  }, [searchParams]);

  const handleForgotPassword = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setDevResetToken('');
    setDevResetExpiry('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || 'Failed to start password reset');
      }

      setDevResetToken(data.reset_token || '');
      setDevResetExpiry(data.expires_at || '');
      toast.success(data.message || 'Password reset flow started');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async (event) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_token: resetToken, new_password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to reset password');
      }

      toast.success(data.message || 'Password reset successfully');
      navigate('/login');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isForgotMode = mode === 'forgot';

  return (
    <Box className="auth-shell">
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' },
            gap: 3,
            alignItems: 'stretch',
          }}
        >
          <Paper
            sx={{
              p: { xs: 3, md: 4 },
              borderRadius: 4,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              minHeight: { xs: 260, md: 620 },
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                opacity: theme.palette.mode === 'dark' ? 0.2 : 0.3,
                pointerEvents: 'none',
                backgroundImage: `linear-gradient(${alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.05)} 1px, transparent 1px)`,
                backgroundSize: '32px 32px',
              }}
            />
            <Box sx={{ position: 'relative' }}>
              <Typography className="industrial-kicker">Security Console</Typography>
              <Typography className="industrial-title">
                {isForgotMode ? 'Access Recovery' : 'Reset Credentials'}
              </Typography>
              <Typography className="industrial-subtitle">
                {isForgotMode
                  ? 'Request a reset token for your GarageOS account. In development, the token is shown directly so recovery can be tested without email infrastructure.'
                  : 'Provide the reset token and set a new password that satisfies the current password policy.'}
              </Typography>
            </Box>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 3, position: 'relative' }}>
              <Chip label="Email-first auth" color="primary" variant="outlined" />
              <Chip label="Dev-safe reset flow" color="secondary" variant="outlined" />
              <Chip label="Rotating session model" variant="outlined" />
            </Stack>

            {isForgotMode && devResetToken ? (
              <Paper sx={{ p: 2.25, mt: 4, position: 'relative', zIndex: 1 }}>
                <Typography variant="subtitle2" color="secondary" gutterBottom>
                  Development Reset Token
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mb: 1.25 }}>
                  {devResetToken}
                </Typography>
                {devResetExpiry ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    Expires: {new Date(devResetExpiry).toLocaleString()}
                  </Typography>
                ) : null}
                <Button variant="outlined" onClick={() => navigate(`/reset-password?token=${encodeURIComponent(devResetToken)}`)}>
                  Continue To Reset
                </Button>
              </Paper>
            ) : null}
          </Paper>

          <Paper sx={{ p: { xs: 3, md: 4 }, borderRadius: 4, alignSelf: 'center' }}>
            <Typography className="industrial-kicker">Recovery Node</Typography>
            <Typography variant="h5" sx={{ mb: 1 }}>
              {isForgotMode ? 'Forgot Password' : 'Reset Password'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {isForgotMode
                ? 'Enter your email address and GarageOS will prepare a reset token.'
                : 'Paste the reset token and choose a new password with uppercase, lowercase, and number characters.'}
            </Typography>

            {isForgotMode ? (
              <form onSubmit={handleForgotPassword}>
                <Stack spacing={2}>
                  <TextField
                    fullWidth
                    label="Email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <Button type="submit" fullWidth variant="contained" disabled={submitting} sx={{ py: 1.6 }}>
                    {submitting ? 'Preparing Reset...' : 'Request Reset Token'}
                  </Button>
                </Stack>
              </form>
            ) : (
              <form onSubmit={handleResetPassword}>
                <Stack spacing={2}>
                  <TextField
                    fullWidth
                    label="Reset Token"
                    value={resetToken}
                    onChange={(event) => setResetToken(event.target.value)}
                  />
                  <TextField
                    fullWidth
                    label="New Password"
                    type="password"
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                  />
                  <TextField
                    fullWidth
                    label="Confirm New Password"
                    type="password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <Alert severity="info" sx={{ alignItems: 'center' }}>
                    Password must be at least 8 characters and include uppercase, lowercase, and number characters.
                  </Alert>
                  <Button type="submit" fullWidth variant="contained" disabled={submitting} sx={{ py: 1.6 }}>
                    {submitting ? 'Resetting...' : 'Set New Password'}
                  </Button>
                </Stack>
              </form>
            )}

            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 2.5, gap: 2, flexWrap: 'wrap' }}>
              <Link component="button" type="button" underline="hover" color="primary" onClick={() => navigate('/login')}>
                Back To Sign In
              </Link>
              <Link
                component="button"
                type="button"
                underline="hover"
                color="secondary"
                onClick={() => navigate(isForgotMode ? '/register' : '/forgot-password')}
              >
                {isForgotMode ? 'Create Account Instead' : 'Need A New Reset Token?'}
              </Link>
            </Box>
          </Paper>
        </Box>
      </Container>
    </Box>
  );
}

export default PasswordRecoveryPage;