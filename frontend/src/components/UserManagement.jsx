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
  DialogTitle,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { TableSectionSkeleton } from './SectionSkeletons';

const ROLE_OPTIONS = ['user', 'admin'];

const roleChipSx = (theme, role) => {
  const color = role === 'admin' ? theme.palette.secondary.main : theme.palette.primary.main;
  return {
    color,
    borderColor: alpha(color, 0.38),
    backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.08 : 0.12),
  };
};

function UserManagement() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState(null);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetTokenData, setResetTokenData] = useState(null);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
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
      const res = await fetch(`/api/admin/users/${targetUser.id}/role`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
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

  const handleCreateResetToken = async (targetUser) => {
    setSavingUserId(targetUser.id);
    try {
      const res = await fetch(`/api/admin/users/${targetUser.id}/reset-password-token`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
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
      const res = await fetch(`/api/admin/users/${targetUser.id}/revoke-sessions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
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

  if (loading) {
    return <TableSectionSkeleton rows={4} />;
  }

  return (
    <Box className="section-shell">
      <Typography variant="h4" fontWeight="800" sx={{ mb: 1 }}>
        User Management
      </Typography>

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
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, flexWrap: 'wrap' }}>
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={savingUserId === entry.id}
                        onClick={() => handleCreateResetToken(entry)}
                      >
                        Create Reset Token
                      </Button>
                      <Button
                        size="small"
                        variant="outlined"
                        color="error"
                        disabled={savingUserId === entry.id}
                        onClick={() => handleRevokeSessions(entry)}
                      >
                        Force Logout
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

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