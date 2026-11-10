import React, { useState } from 'react';
import {
  Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, Paper, Typography,
} from '@mui/material';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import PasswordField from './PasswordField';

/**
 * The account's own copy of its data, and the way out.
 *
 * The export is everything as one JSON file — the GDPR copy, beside the CSV that
 * Records exports for spreadsheets. Deletion waits 30 days and signs every device out
 * at once; signing in again inside the window shows a banner that cancels it.
 */
const AccountDataSettings = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await apiFetch('/api/auth/export');
      if (!res.ok) throw new Error('Could not prepare the export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `mileage-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await apiFetch('/api/auth/delete-account', { method: 'POST', body: JSON.stringify({ password }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.detail || 'Could not schedule the deletion');
      const when = new Date(data.deletion_scheduled_for).toLocaleDateString();
      setConfirmOpen(false);
      // Every session was revoked server-side; this clears the one in this browser.
      await logout();
      toast.success(`Your account will be deleted on ${when}. Sign in before then to keep it.`);
      navigate('/login');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>Your data</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Everything this account holds — vehicles, every record, places, settings — as one
        JSON file. For a spreadsheet, use the CSV export on Records instead.
      </Typography>
      <Button variant="outlined" onClick={handleExport} disabled={exporting}>
        {exporting ? 'Preparing…' : 'Download all my data'}
      </Button>

      <Divider sx={{ my: 2.5 }} />

      <Typography variant="subtitle1" fontWeight={700}>Delete account</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Signs you out everywhere and deletes the account and all its records after 30 days.
        Signing in before then cancels it.
      </Typography>
      {user?.role === 'admin' ? (
        <Typography variant="body2" color="text.secondary">
          An admin account cannot delete itself. Give the admin role to someone else first.
        </Typography>
      ) : (
        <Button color="error" variant="outlined" onClick={() => { setPassword(''); setConfirmOpen(true); }}>
          Delete my account
        </Button>
      )}

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            You will be signed out on every device. In 30 days the account and every record in
            it are deleted for good. Download your data first if you want to keep it.
          </DialogContentText>
          <Box>
            <PasswordField label="Your password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={!password || deleting}>
            {deleting ? 'Deleting…' : 'Delete account'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default AccountDataSettings;
