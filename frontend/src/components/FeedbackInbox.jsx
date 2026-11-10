import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, MenuItem, Paper, Stack, TextField, Typography,
} from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { FEEDBACK_KINDS, FEEDBACK_STATUS } from '../utils/feedback';

const readError = async (res, fallback) => {
  const data = await res.json().catch(() => null);
  return data?.detail || fallback;
};

const daysLeft = (due) => Math.ceil((new Date(due) - Date.now()) / 86400000);

const Detail = ({ id, onChanged }) => {
  const [item, setItem] = useState(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/admin/feedback/${id}`);
    setItem(res.ok ? await res.json() : null);
  }, [id]);

  useEffect(() => { setItem(null); load(); }, [load]);

  const send = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/admin/feedback/${id}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) });
      if (!res.ok) throw new Error(await readError(res, 'Could not send the answer'));
      const data = await res.json();
      setReply('');
      toast.success(data.message);
      load();
      onChanged();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    const res = await apiFetch(`/api/admin/feedback/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    if (!res.ok) {
      toast.error(await readError(res, 'Could not change the status'));
      return;
    }
    load();
    onChanged();
  };

  if (!item) return <Box sx={{ p: 3, display: 'flex', justifyContent: 'center' }}><CircularProgress size={24} /></Box>;

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Chip size="small" label={FEEDBACK_KINDS[item.kind]?.label} color={item.kind === 'complaint' ? 'error' : 'default'} />
        <TextField select size="small" value={item.status} onChange={(event) => setStatus(event.target.value)} sx={{ minWidth: 170 }}>
          {Object.entries(FEEDBACK_STATUS).map(([value, status]) => <MenuItem key={value} value={value}>{status.label}</MenuItem>)}
        </TextField>
        {item.due_at ? (
          <Typography variant="body2" color={daysLeft(item.due_at) <= 5 ? 'error.main' : 'text.secondary'}>
            Answer due {new Date(item.due_at).toLocaleDateString()} ({daysLeft(item.due_at)} days)
          </Typography>
        ) : null}
      </Stack>
      <Typography variant="h6">{item.subject}</Typography>
      <Typography variant="caption" color="text.secondary">
        {item.account_deleted ? 'Account deleted' : item.username} · {item.contact_email || 'no address'} · {new Date(item.created_at).toLocaleString()}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{item.body}</Typography>
      {Object.keys(item.context || {}).length ? (
        <Box component="pre" sx={{ m: 0, p: 1.5, borderRadius: 2, bgcolor: 'action.hover', fontSize: 12, overflowX: 'auto' }}>
          {Object.entries(item.context).map(([key, value]) => `${key}: ${value}`).join('\n')}
        </Box>
      ) : null}
      {item.messages.map((message) => (
        <Box key={message.id} sx={{ p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: message.from_admin ? 'action.hover' : 'transparent' }}>
          <Typography variant="caption" color="text.secondary">
            {message.from_admin ? 'Answered' : 'User'} · {new Date(message.created_at).toLocaleString()}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{message.body}</Typography>
        </Box>
      ))}
      <TextField multiline minRows={3} maxRows={12} placeholder="Answer — it is emailed to the sender and kept here"
        value={reply} onChange={(event) => setReply(event.target.value)} />
      <Box>
        <Button variant="contained" onClick={send} disabled={!reply.trim() || busy}>Send answer</Button>
      </Box>
    </Stack>
  );
};

/**
 * Every account's ideas, bug reports and complaints. Open complaints come first, by
 * deadline: they are the ones with a legal clock on them.
 */
const FeedbackInbox = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filter, setFilter] = useState({ status: 'open', kind: '' });
  const [items, setItems] = useState(null);
  const selected = Number(searchParams.get('id')) || null;

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter.status) params.set('status', filter.status);
    if (filter.kind) params.set('kind', filter.kind);
    const res = await apiFetch(`/api/admin/feedback?${params}`);
    setItems(res.ok ? await res.json() : []);
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const select = (id) => {
    const params = new URLSearchParams(searchParams);
    if (id) params.set('id', id); else params.delete('id');
    setSearchParams(params, { replace: true });
  };

  const overdue = (items || []).filter((item) => item.due_at && ['new', 'in_progress'].includes(item.status) && daysLeft(item.due_at) <= 5);

  return (
    <Stack spacing={2}>
      {overdue.length ? (
        <Alert severity="error">{overdue.length} complaint{overdue.length === 1 ? '' : 's'} due within 5 days.</Alert>
      ) : null}
      <Stack direction="row" spacing={1.5}>
        <TextField select size="small" label="Status" value={filter.status} sx={{ minWidth: 160 }}
          onChange={(event) => setFilter({ ...filter, status: event.target.value })}>
          <MenuItem value="open">Open</MenuItem>
          <MenuItem value="">All</MenuItem>
          {Object.entries(FEEDBACK_STATUS).map(([value, status]) => <MenuItem key={value} value={value}>{status.label}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Kind" value={filter.kind} sx={{ minWidth: 150 }}
          onChange={(event) => setFilter({ ...filter, kind: event.target.value })}>
          <MenuItem value="">All</MenuItem>
          {Object.entries(FEEDBACK_KINDS).map(([value, kind]) => <MenuItem key={value} value={value}>{kind.label}</MenuItem>)}
        </TextField>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(260px, 2fr) 3fr' }, gap: 2, alignItems: 'start' }}>
        <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
          {items === null ? <Box sx={{ p: 3 }}><CircularProgress size={24} /></Box> : null}
          {items && !items.length ? <Typography sx={{ p: 2.5 }} color="text.secondary">Nothing here.</Typography> : null}
          <Stack divider={<Divider flexItem />}>
            {(items || []).map((item) => (
              <Box key={item.id} onClick={() => select(item.id)} sx={{
                p: 1.5, cursor: 'pointer', minWidth: 0,
                bgcolor: selected === item.id ? 'action.selected' : 'transparent',
                '&:hover': { bgcolor: 'action.hover' },
              }}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Typography fontWeight={item.status === 'new' ? 700 : 500} noWrap sx={{ flex: 1, minWidth: 0 }}>{item.subject}</Typography>
                  {item.kind === 'complaint' ? <Chip size="small" color="error" variant="outlined" label="Complaint" /> : null}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {FEEDBACK_KINDS[item.kind]?.label} · {FEEDBACK_STATUS[item.status]?.label} · {new Date(item.created_at).toLocaleDateString()}
                  {item.message_count ? ` · ${item.message_count} message${item.message_count === 1 ? '' : 's'}` : ''}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Paper>
        <Paper sx={{ p: 2.5, borderRadius: 3, minWidth: 0 }}>
          {selected ? <Detail id={selected} onChanged={load} /> : (
            <Typography color="text.secondary">Pick a message to read and answer it.</Typography>
          )}
        </Paper>
      </Box>
    </Stack>
  );
};

export default FeedbackInbox;
