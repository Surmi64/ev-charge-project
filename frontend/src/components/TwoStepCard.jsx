import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack,
  TextField, Typography,
} from '@mui/material';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useAuth } from '../context/useAuth';
import PasswordField from './PasswordField';

const post = async (path, body) => {
  const res = await apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || 'That did not work. Try again.');
  return data;
};

// Read off a screen into an app by hand when the camera is not an option.
const groupSecret = (secret) => secret.replace(/(.{4})/g, '$1 ').trim();

const RecoveryCodes = ({ codes }) => {
  const text = `Mileage recovery codes\nEach works once, in place of a code from your authenticator app.\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Recovery codes copied');
    } catch {
      toast.error('Could not copy. Select the codes and copy them by hand.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mileage-recovery-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        Keep these somewhere safe, away from your phone. Each one signs you in once if the phone is lost.
        They will not be shown again.
      </Typography>
      <Box
        component="ul"
        sx={{
          m: 0, p: 1.5, listStyle: 'none', borderRadius: 2, border: 1, borderColor: 'divider',
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.95rem',
        }}
      >
        {codes.map((code) => <li key={code}>{code}</li>)}
      </Box>
      <Stack direction="row" spacing={1}>
        <Button size="small" onClick={copy}>Copy</Button>
        <Button size="small" onClick={download}>Download</Button>
      </Stack>
    </Stack>
  );
};

/** Switching two-step sign-in on: password, then scan and confirm, then the recovery codes. */
const EnableDialog = ({ open, onClose, onEnabled }) => {
  const [step, setStep] = useState('password');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep('password'); setPassword(''); setSetup(null); setQr(''); setCode(''); setCodes([]); setError('');
  }, [open]);

  useEffect(() => {
    if (!setup) return;
    // A data: URL image, which the CSP's img-src already allows.
    QRCode.toDataURL(setup.otpauth_uri, { margin: 1, width: 200, errorCorrectionLevel: 'M' })
      .then(setQr)
      .catch(() => setQr(''));
  }, [setup]);

  const run = async (action) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  const start = (event) => {
    event.preventDefault();
    run(async () => {
      setSetup(await post('/api/auth/mfa/setup', { password }));
      setStep('scan');
    });
  };

  const confirm = (event) => {
    event.preventDefault();
    run(async () => {
      const data = await post('/api/auth/mfa/enable', { code });
      setCodes(data.recovery_codes);
      setStep('codes');
      onEnabled(data);
    });
  };

  return (
    <Dialog open={open} onClose={step === 'codes' ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        {step === 'codes' ? 'Save your recovery codes' : 'Turn on two-step sign-in'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
          {step === 'password' ? (
            <form id="mfa-password" onSubmit={start}>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  You will need an authenticator app, such as Google Authenticator, Microsoft Authenticator, 1Password
                  or Aegis. Confirm your password to begin.
                </Typography>
                <PasswordField label="Password" value={password} onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password" autoFocus />
              </Stack>
            </form>
          ) : null}
          {step === 'scan' && setup ? (
            <form id="mfa-confirm" onSubmit={confirm}>
              <Stack spacing={2} alignItems="stretch">
                <Typography variant="body2" color="text.secondary">
                  Scan this with the app, then enter the 6-digit code it shows.
                </Typography>
                <Box sx={{ alignSelf: 'center', p: 1, bgcolor: '#fff', borderRadius: 2, lineHeight: 0, minHeight: 200, minWidth: 200 }}>
                  {qr ? <img src={qr} width={200} height={200} alt="QR code for your authenticator app" /> : null}
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">Can&apos;t scan? Enter this key instead:</Typography>
                  <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all', userSelect: 'all' }}>
                    {groupSecret(setup.secret)}
                  </Typography>
                </Box>
                <TextField label="Code from the app" value={code} onChange={(event) => setCode(event.target.value)}
                  autoComplete="one-time-code" autoFocus
                  slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 8 } }} />
              </Stack>
            </form>
          ) : null}
          {step === 'codes' ? <RecoveryCodes codes={codes} /> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        {step === 'codes' ? (
          <Button variant="contained" onClick={onClose}>I have saved them</Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form={step === 'password' ? 'mfa-password' : 'mfa-confirm'} variant="contained"
              disabled={busy || (step === 'password' ? !password : !code.trim())}>
              {step === 'password' ? 'Continue' : 'Turn on'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

/** Needs a current code (and for switching off, the password too). */
const CodeDialog = ({ open, mode, onClose, onDone }) => {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const disabling = mode === 'disable';

  useEffect(() => {
    if (open) { setPassword(''); setCode(''); setCodes(null); setError(''); }
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (disabling) {
        await post('/api/auth/mfa/disable', { password, code });
        onDone();
        onClose();
      } else {
        const data = await post('/api/auth/mfa/recovery-codes', { code });
        setCodes(data.recovery_codes);
        onDone();
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={codes ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{disabling ? 'Turn off two-step sign-in' : 'New recovery codes'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          {error ? <Alert severity="error" role="alert">{error}</Alert> : null}
          {codes ? <RecoveryCodes codes={codes} /> : (
            <form id="mfa-code" onSubmit={submit}>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {disabling
                    ? 'Signing in will take only your password again.'
                    : 'Your current recovery codes stop working as soon as the new ones are made.'}
                </Typography>
                {disabling ? (
                  <PasswordField label="Password" value={password} onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password" autoFocus />
                ) : null}
                <TextField label="Code from the app, or a recovery code" value={code}
                  onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" autoFocus={!disabling}
                  slotProps={{ htmlInput: { maxLength: 32, spellCheck: false, autoCapitalize: 'none' } }} />
              </Stack>
            </form>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {codes ? <Button variant="contained" onClick={onClose}>I have saved them</Button> : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" form="mfa-code" variant="contained" color={disabling ? 'error' : 'primary'}
              disabled={busy || !code.trim() || (disabling && !password)}>
              {disabling ? 'Turn off' : 'Make new codes'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

/** Account › Security: two-step sign-in with an authenticator app. */
const TwoStepCard = ({ onSessionsChanged }) => {
  const { updateUser } = useAuth();
  const [state, setState] = useState(null);
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/mfa');
      setState(res.ok ? await res.json() : { enabled: false, unavailable: true });
    } catch {
      setState({ enabled: false, unavailable: true });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const enabled = Boolean(state?.enabled);
  const low = enabled && state.recovery_codes_remaining <= 3;

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'flex-start' }} spacing={2}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h6">Two-step sign-in</Typography>
            {state ? (
              <Chip size="small" variant="outlined" color={enabled ? 'success' : 'default'} label={enabled ? 'On' : 'Off'} />
            ) : null}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {enabled
              ? `Signing in takes your password and a code from your authenticator app. On since ${new Date(state.enabled_at).toLocaleDateString()}.`
              : 'Ask for a code from an authenticator app as well as your password, so a leaked password alone cannot open the account.'}
          </Typography>
          {enabled ? (
            <Typography variant="body2" color={low ? 'warning.main' : 'text.secondary'} sx={{ mt: 0.75 }}>
              {state.recovery_codes_remaining} recovery code{state.recovery_codes_remaining === 1 ? '' : 's'} left
              {low ? ' — make new ones before you run out.' : '.'}
            </Typography>
          ) : null}
          {state?.required ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
              Required for admins on this site.
            </Typography>
          ) : null}
        </Box>
        {state === null ? <CircularProgress size={24} /> : enabled ? (
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            <Button size="small" onClick={() => setDialog('codes')}>New recovery codes</Button>
            {!state.required ? <Button size="small" color="error" onClick={() => setDialog('disable')}>Turn off</Button> : null}
          </Stack>
        ) : (
          <Button variant="contained" sx={{ flexShrink: 0 }} disabled={state.unavailable} onClick={() => setDialog('enable')}>
            Turn on
          </Button>
        )}
      </Stack>

      <EnableDialog
        open={dialog === 'enable'}
        onClose={() => { setDialog(null); load(); }}
        onEnabled={(data) => {
          updateUser({ mfa_enabled: true });
          onSessionsChanged?.();
          if (data.signed_out_sessions) {
            toast.success(`Signed out of ${data.signed_out_sessions} other device${data.signed_out_sessions === 1 ? '' : 's'}`);
          }
        }}
      />
      <CodeDialog
        open={dialog === 'disable' || dialog === 'codes'}
        mode={dialog === 'disable' ? 'disable' : 'codes'}
        onClose={() => { setDialog(null); load(); }}
        onDone={() => {
          if (dialog === 'disable') {
            updateUser({ mfa_enabled: false });
            toast.success('Two-step sign-in is off');
          }
        }}
      />
    </Paper>
  );
};

export default TwoStepCard;
