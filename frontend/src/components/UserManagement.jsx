import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  FormControl,
  Select,
  MenuItem,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  TextField,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  DeleteForeverOutlined as DeleteIcon,
  LockResetOutlined as ResetTokenIcon,
  LogoutOutlined as ForceLogoutIcon,
} from '@mui/icons-material';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { TableSectionSkeleton } from './SectionSkeletons';
import { apiFetch } from '../utils/api';
import { useDelayedLoading } from '../utils/useDelayedLoading';

const ROLE_OPTIONS = ['user', 'admin'];

const roleChipSx = (theme, role) => {
  const color = role === 'admin' ? theme.palette.secondary.main : theme.palette.primary.main;
  return {
    color,
    borderColor: alpha(color, 0.38),
    backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.08 : 0.12),
  };
};

function UserManagement({ embedded = false }) {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  // Skip the placeholder entirely when the data beats the delay.
  const showSkeleton = useDelayedLoading(loading);
  const [savingUserId, setSavingUserId] = useState(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTokenData, setResetTokenData] = useState(null);

  const fetchUsers = async () => {
    try {
      const res = await apiFetch('/api/admin/users');
      if (!res.ok) throw new Error('Failed to load users');
      setUsers(await res.json());
    } catch (error) {
      toast.error(error.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (targetUser, nextRole) => {
    const previousUsers = users;
    setSavingUserId(targetUser.id);
    setUsers((currentUsers) => currentUsers.map((item) => (item.id === targetUser.id ? { ...item, role: nextRole } : item)));

    try {
      const res = await apiFetch(`/api/admin/users/${targetUser.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to update role');
      }
      toast.success(`Role updated for ${targetUser.email}`);
      await fetchUsers();
    } catch (error) {
      setUsers(previousUsers);
      toast.error(error.message);
    } finally {
      setSavingUserId(null);
    }
  };

  // Typed confirmation rather than a plain "are you sure": this destroys another
  // account's entire history, it cannot be undone, and there is no soft-delete to fall
  // back on the way archiving covers vehicles.
  const [pendingDelete, setPendingDelete] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);

  const handleDeleteUser = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/admin/users/${pendingDelete.id}`, { method: 'DELETE' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.detail || 'Could not delete that user');
      toast.success(payload.message || 'User deleted');
      setPendingDelete(null);
      setDeleteConfirmation('');
      fetchUsers();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleCreateResetToken = async (targetUser) => {
    setSavingUserId(targetUser.id);
    try {
      const res = await apiFetch(`/api/admin/users/${targetUser.id}/reset-password-token`, {
        method: 'POST',
        });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to create reset token');
      }
      setResetTokenData(data);
      setResetDialogOpen(true);
      toast.success(`Reset token created for ${targetUser.email}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingUserId(null);
    }
  };

  const handleRevokeSessions = async (targetUser) => {
    setSavingUserId(targetUser.id);
    try {
      const res = await apiFetch(`/api/admin/users/${targetUser.id}/revoke-sessions`, {
        method: 'POST',
        });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to revoke sessions');
      }
      toast.success(`${data.revoked_sessions} active sessions revoked for ${targetUser.email}`);
      await fetchUsers();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSavingUserId(null);
    }
  };

  if (showSkeleton) return <TableSectionSkeleton rows={4} />;
  if (loading) return null;

  return (
    <Box className={embedded ? undefined : 'section-shell stagger'}>
      {/* The Admin page supplies the heading; a second h1 inside a tab panel would
          both duplicate it and break the heading order. */}
      {embedded ? null : (
        <Typography variant="h4" component="h1" fontWeight="800" sx={{ mb: 1 }}>
          User Management
        </Typography>
      )}

      <Paper sx={{ p: 2.5, borderRadius: 4 }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Only admins can view and manage user roles.
        </Typography>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>User</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>Created</TableCell>
                <TableCell>Last Login</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>
                    <Typography variant="body1" fontWeight={700}>{entry.username}</Typography>
                    {entry.id === user?.id ? (
                      <Typography variant="caption" color="text.secondary">Current session</Typography>
                    ) : null}
                  </TableCell>
                  <TableCell>{entry.email}</TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Chip size="small" label={entry.role} variant="outlined" sx={(theme) => roleChipSx(theme, entry.role)} />
                      <FormControl size="small" sx={{ minWidth: 120 }} disabled={savingUserId === entry.id}>
                        <Select value={entry.role} onChange={(event) => handleRoleChange(entry, event.target.value)}>
                          {ROLE_OPTIONS.map((role) => (
                            <MenuItem key={role} value={role}>{role}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                  </TableCell>
                  <TableCell>{entry.created_at ? new Date(entry.created_at).toLocaleDateString() : '-'}</TableCell>
                  <TableCell>{entry.last_login_at ? new Date(entry.last_login_at).toLocaleString() : 'Never'}</TableCell>
                  <TableCell align="right">
                    {/* Icon-only, so the column stays narrow. Each carries its own
                        aria-label rather than relying on the tooltip, which a screen
                        reader does not announce. The span wrappers are what let a
                        tooltip still appear on a disabled button.

                        `size="small"` alone gives a 30px target, under every platform
                        minimum, on the one row where a mis-tap deletes an account. The
                        padding grows the hit area to 40px without changing how big the
                        icons look. */}
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 0.5 }}>
                      <Tooltip title="Create a password reset token">
                        <span>
                          <IconButton
                            size="small"
                            sx={{ p: 1.25 }}
                            aria-label={`Create a password reset token for ${entry.email}`}
                            disabled={savingUserId === entry.id}
                            onClick={() => handleCreateResetToken(entry)}
                          >
                            <ResetTokenIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title="Sign this account out everywhere">
                        <span>
                          <IconButton
                            size="small"
                            color="warning"
                            sx={{ p: 1.25 }}
                            aria-label={`Sign ${entry.email} out of every device`}
                            disabled={savingUserId === entry.id}
                            onClick={() => handleRevokeSessions(entry)}
                          >
                            <ForceLogoutIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip
                        title={
                          entry.id === user?.id ? 'You cannot delete your own account'
                            : entry.is_bootstrap_admin ? 'The bootstrap admin account cannot be deleted'
                            : 'Delete this account and all its records'
                        }
                      >
                        <span>
                          <IconButton
                            size="small"
                            color="error"
                            sx={{ p: 1.25 }}
                            aria-label={`Delete ${entry.email} and all of its records`}
                            disabled={savingUserId === entry.id || entry.id === user?.id || entry.is_bootstrap_admin}
                            onClick={() => { setPendingDelete(entry); setDeleteConfirmation(''); }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      <Dialog
        open={!!pendingDelete}
        onClose={() => { if (!deleting) { setPendingDelete(null); setDeleteConfirmation(''); } }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Delete {pendingDelete?.email}?</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            <Typography variant="body2" sx={{ mb: 1.5 }}>
              This permanently removes the account together with every vehicle, charging
              and fuelling session, cost, reminder and subscription record it owns. There
              is no undo and no archive to restore from.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The security log keeps a record that this happened.
            </Typography>
          </DialogContentText>
          <TextField
            fullWidth
            autoFocus
            label="Type the email address to confirm"
            value={deleteConfirmation}
            onChange={(event) => setDeleteConfirmation(event.target.value)}
            placeholder={pendingDelete?.email}
            disabled={deleting}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setPendingDelete(null); setDeleteConfirmation(''); }} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteUser}
            // Case-insensitive: retyping an address is a deliberateness check, not a
            // spelling test.
            disabled={deleting || deleteConfirmation.trim().toLowerCase() !== (pendingDelete?.email || '').toLowerCase()}
          >
            {deleting ? 'Deleting…' : 'Delete account'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={resetDialogOpen} onClose={() => setResetDialogOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Development Reset Token</DialogTitle>
        <DialogContent>
          {resetTokenData ? (
            <Box sx={{ display: 'grid', gap: 1.5, pt: 1 }}>
              <Typography variant="body2" color="text.secondary">
                Target user: {resetTokenData.target_email}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Expires: {resetTokenData.expires_at ? new Date(resetTokenData.expires_at).toLocaleString() : '-'}
              </Typography>
              <Paper sx={{ p: 2, borderRadius: 3 }}>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.75 }}>
                  Reset token
                </Typography>
                <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {resetTokenData.reset_token || 'Token is hidden outside development environments.'}
                </Typography>
              </Paper>
            </Box>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default UserManagement;