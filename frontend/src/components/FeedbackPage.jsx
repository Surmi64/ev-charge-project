import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, Paper, Stack, TextField, ToggleButton,
  ToggleButtonGroup, Typography,
} from '@mui/material';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { FEEDBACK_KINDS, FEEDBACK_STATUS } from '../utils/feedback';

const readError = async (res, fallback) => {
  const data = await res.json().catch(() => null);
  return data?.detail || fallback;
};

const Thread = ({ item, onReplied }) => {
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    setSending(true);
    try {
      const res = await apiFetch(`/api/feedback/${item.id}/messages`, { method: 'POST', body: JSON.stringify({ body: reply }) });
      if (!res.ok) throw new Error(await readError(res, 'Could not send the reply'));
      setReply('');
      onReplied();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Stack spacing={1.25} sx={{ mt: 1.5 }}>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{item.body}</Typography>
      {item.messages.map((message) => (
        <Box key={message.id} sx={{
          p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider',
          bgcolor: message.from_admin ? 'action.hover' : 'transparent',
        }}>
          <Typography variant="caption" color="text.secondary">
            {message.from_admin ? 'Mileage' : 'You'} · {new Date(message.created_at).toLocaleString()}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{message.body}</Typography>
        </Box>
      ))}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField size="small" fullWidth multiline maxRows={6} placeholder="Add to this conversation"
          value={reply} onChange={(event) => setReply(event.target.value)} />
        <Button onClick={send} disabled={!reply.trim() || sending} sx={{ flexShrink: 0 }}>Send</Button>
      </Stack>
    </Stack>
  );
};

/**
 * Ideas, bug reports and complaints, sent from inside the app, and their answers.
 *
 * Works on a lapsed plan too: a complaint about billing is most likely to come from
 * exactly that account. The page, app build and last failed request travel with the
 * message as context, so a bug report does not depend on the reader describing it.
 */
const FeedbackPage = () => {
  const [items, setItems] = useState(null);
  const [form, setForm] = useState({ kind: 'idea', subject: '', body: '' });
  const [sending, setSending] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/feedback');
      setItems(res.ok ? await res.json() : []);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    setSending(true);
    try {
      const res = await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          subject: form.subject.trim(),
          body: form.body.trim(),
          context: {
            page: document.referrer ? new URL(document.referrer).pathname : '',
            screen: `${window.innerWidth}x${window.innerHeight}`,
            language: navigator.language,
            build: import.meta.env.VITE_APP_VERSION || 'dev',
          },
        }),
      });
      if (!res.ok) throw new Error(await readError(res, 'Could not send your message'));
      const created = await res.json();
      setForm({ kind: form.kind, subject: '', body: '' });
      setItems((current) => [created, ...(current || [])]);
      toast.success(form.kind === 'complaint' ? 'Complaint received — you will get a written answer within 30 days' : 'Thanks — message received');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Box className="section-shell stagger">
      <Typography variant="h4" component="h1" fontWeight={800} sx={{ mb: 0.5 }}>Feedback</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        Ideas, bugs and complaints go straight to the people who build Mileage. Every one is read.
      </Typography>

      <Stack spacing={3} sx={{ maxWidth: 760, minWidth: 0 }}>
        <Paper component="form" onSubmit={submit} sx={{ p: 2.5, borderRadius: 4 }}>
          <ToggleButtonGroup
            exclusive size="small" value={form.kind}
            onChange={(_event, kind) => kind && setForm({ ...form, kind })}
            sx={{ mb: 1, flexWrap: 'wrap' }}
          >
            {Object.entries(FEEDBACK_KINDS).map(([value, kind]) => (
              <ToggleButton key={value} value={value}>{kind.label}</ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{FEEDBACK_KINDS[form.kind].hint}</Typography>
          <Stack spacing={2}>
            <TextField label="Subject" size="small" required value={form.subject} inputProps={{ maxLength: 200 }}
              onChange={(event) => setForm({ ...form, subject: event.target.value })} />
            <TextField label="Message" multiline minRows={4} maxRows={14} required value={form.body}
              inputProps={{ maxLength: 5000 }}
              helperText={form.body.trim().length < 10 ? 'A sentence or two is enough.' : `${form.body.length} / 5000`}
              onChange={(event) => setForm({ ...form, body: event.target.value })} />
          </Stack>
          <Button type="submit" variant="contained" sx={{ mt: 2 }}
            disabled={sending || form.subject.trim().length < 3 || form.body.trim().length < 10}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: 4 }}>
          <Typography variant="h6" gutterBottom>Your messages</Typography>
          {items === null ? <CircularProgress size={24} /> : null}
          {items && !items.length ? (
            <Typography variant="body2" color="text.secondary">Nothing sent yet.</Typography>
          ) : null}
          <Stack divider={<Divider flexItem />} spacing={1.5}>
            {(items || []).map((item) => {
              const status = FEEDBACK_STATUS[item.status] || FEEDBACK_STATUS.new;
              const unread = item.messages.some((message) => message.from_admin);
              return (
                <Box key={item.id}>
                  <Stack
                    direction="row" spacing={1} alignItems="center" sx={{ cursor: 'pointer', minWidth: 0 }}
                    onClick={() => setOpenId(openId === item.id ? null : item.id)}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={600} noWrap>{item.subject}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {FEEDBACK_KINDS[item.kind]?.label} · {new Date(item.created_at).toLocaleDateString()}
                        {item.messages.length ? ` · ${item.messages.length} repl${item.messages.length === 1 ? 'y' : 'ies'}` : ''}
                      </Typography>
                    </Box>
                    <Chip size="small" variant="outlined" color={status.color} label={status.label} />
                    {unread && openId !== item.id ? <Chip size="small" color="primary" label="Answer" /> : null}
                  </Stack>
                  {openId === item.id ? <Thread item={item} onReplied={load} /> : null}
                </Box>
              );
            })}
          </Stack>
        </Paper>

        <Alert severity="info" variant="outlined">
          Complaints are answered in writing within 30 days. See the{' '}
          <a href="/terms" target="_blank" rel="noopener">terms</a> for how complaints are handled.
        </Alert>
      </Stack>
    </Box>
  );
};

export default FeedbackPage;
