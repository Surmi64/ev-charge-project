import React, { useState } from 'react';
import { Alert, Button } from '@mui/material';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { useSiteConfig } from '../utils/useSiteConfig';

const readError = async (res, fallback) => {
  const data = await res.json().catch(() => null);
  return data?.detail || fallback;
};

/**
 * Account states that need the holder's attention on every page.
 *
 * A pending deletion always shows, with the way out right on it: signing in during the
 * grace period is exactly how a deletion is meant to be undone. An unconfirmed address
 * shows only when the instance requires confirmation — until outgoing mail works, a
 * banner asking for a link that never arrives would only be noise.
 */
const AccountBanner = () => {
  const { user, updateUser } = useAuth();
  const { require_email_verification: verificationRequired } = useSiteConfig();
  const [busy, setBusy] = useState(false);

  if (!user) return null;

  const call = async (path, fallback, onDone) => {
    setBusy(true);
    try {
      const res = await apiFetch(path, { method: 'POST' });
      if (!res.ok) throw new Error(await readError(res, fallback));
      const data = await res.json();
      onDone?.(data);
      toast.success(data.message);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (user.deletion_scheduled_for) {
    const when = new Date(user.deletion_scheduled_for).toLocaleDateString();
    return (
      <Alert
        severity="error"
        sx={{ mb: 2, borderRadius: 2 }}
        action={(
          <Button
            color="inherit" size="small" disabled={busy}
            onClick={() => call('/api/auth/cancel-deletion', 'Could not cancel the deletion',
              () => updateUser({ deletion_scheduled_for: null }))}
          >
            Keep my account
          </Button>
        )}
      >
        This account and all its records will be deleted on {when}.
      </Alert>
    );
  }

  if (verificationRequired && !user.email_verified_at && user.role !== 'admin') {
    return (
      <Alert
        severity="warning"
        sx={{ mb: 2, borderRadius: 2 }}
        action={(
          <Button
            color="inherit" size="small" disabled={busy}
            onClick={() => call('/api/auth/verify-email/resend', 'Could not send the link')}
          >
            Send the link again
          </Button>
        )}
      >
        Confirm {user.email} to start recording — the link is in your inbox.
      </Alert>
    );
  }

  return null;
};

export default AccountBanner;
