import React, { useCallback, useEffect, useState } from 'react';
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';

// A readable name for a browser's self-description. Coarse on purpose: enough to
// recognise "the phone" from "the work laptop", not a fingerprint.
const describeDevice = (agent) => {
  if (!agent) return 'Unknown device';
  const browser = /Edg\//.test(agent) ? 'Edge'
    : /Firefox\//.test(agent) ? 'Firefox'
      : /Chrome\//.test(agent) ? 'Chrome'
        : /Safari\//.test(agent) ? 'Safari'
          : 'Browser';
  const system = /Android/.test(agent) ? 'Android'
    : /iPhone|iPad/.test(agent) ? 'iOS'
      : /Windows/.test(agent) ? 'Windows'
        : /Mac OS X/.test(agent) ? 'macOS'
          : /Linux/.test(agent) ? 'Linux'
            : 'unknown system';
  return `${browser} on ${system}`;
};

/** Where the account is signed in, with a way to end any of it. */
const SessionsCard = () => {
  const [sessions, setSessions] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/auth/sessions');
      setSessions(res.ok ? await res.json() : []);
    } catch {
      setSessions([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (key, path, method) => {
    setBusy(key);
    try {
      const res = await apiFetch(path, { method });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || 'That did not work');
      toast.success(data.message);
      load();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(null);
    }
  };

  const others = (sessions || []).filter((session) => !session.current);

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2} sx={{ mb: 1.5 }}>
        <Box>
          <Typography variant="h6" gutterBottom>Signed-in devices</Typography>
          <Typography variant="body2" color="text.secondary">
            Every browser and phone that can open this account. Sign out of any you do not recognise.
          </Typography>
        </Box>
        {others.length ? (
          <Button size="small" sx={{ flexShrink: 0 }} disabled={busy === 'others'}
            onClick={() => act('others', '/api/auth/sessions/revoke-others', 'POST')}>
            Sign out all others
          </Button>
        ) : null}
      </Stack>

      {sessions === null ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={24} /></Box>
      ) : !sessions.length ? (
        <Typography variant="body2" color="text.secondary">
          No active sign-ins found. Sign out and back in to see this device listed.
        </Typography>
      ) : (
        <Stack spacing={1}>
          {sessions.map((session) => (
            <Stack key={session.id} direction="row" alignItems="center" spacing={1.5}
              sx={{ p: 1.5, borderRadius: 3, border: 1, borderColor: 'divider', minWidth: 0 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={600} noWrap>{describeDevice(session.user_agent)}</Typography>
                  {session.current ? <Chip size="small" color="success" variant="outlined" label="This device" /> : null}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {session.last_used_at ? `Last active ${new Date(session.last_used_at).toLocaleString()}` : 'Not used yet'}
                  {session.ip_address ? ` · ${session.ip_address}` : ''}
                </Typography>
              </Box>
              {!session.current ? (
                <Button size="small" color="error" disabled={busy === session.id}
                  onClick={() => act(session.id, `/api/auth/sessions/${session.id}`, 'DELETE')}>
                  Sign out
                </Button>
              ) : null}
            </Stack>
          ))}
        </Stack>
      )}
    </Paper>
  );
};

export default SessionsCard;
