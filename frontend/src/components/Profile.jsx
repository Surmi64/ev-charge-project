import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, TextField, Button, Divider, CircularProgress, Chip, Stack, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAuth } from '../context/useAuth';
import { toast } from 'sonner';
import PersonIcon from '@mui/icons-material/Person';
import SecurityIcon from '@mui/icons-material/Security';

const Profile = () => {
    const { token, user, updateUser, loading: authLoading } = useAuth();
    const theme = useTheme();
    const [loading, setLoading] = useState(false);
    const [securityLoading, setSecurityLoading] = useState(true);
    const [securityLog, setSecurityLog] = useState([]);
    const [formData, setFormData] = useState({
        username: user?.username || '',
        email: user?.email || '',
        current_password: '',
        new_password: '',
        confirm_password: ''
    });

    useEffect(() => {
        setFormData((prev) => ({
            ...prev,
            username: user?.username || '',
            email: user?.email || '',
        }));
    }, [user]);

    useEffect(() => {
        const fetchSecurityLog = async () => {
            if (!token) {
                setSecurityLoading(false);
                return;
            }

            try {
                const res = await fetch('/api/auth/security-log?limit=10', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });
                if (!res.ok) throw new Error('Failed to load security activity');
                setSecurityLog(await res.json());
            } catch {
                toast.error('Failed to load security activity');
            } finally {
                setSecurityLoading(false);
            }
        };

        fetchSecurityLog();
    }, [token]);

    if (authLoading || !user) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}><CircularProgress /></Box>;
    }

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleUpdate = async (e) => {
        e.preventDefault();

        if (formData.new_password && formData.new_password !== formData.confirm_password) {
            toast.error('New passwords do not match');
            return;
        }

        if (!formData.current_password) {
            toast.error('Current password is required to make changes');
            return;
        }

        setLoading(true);
        try {
            const res = await fetch('/api/auth/me', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    username: formData.username !== user.username ? formData.username : undefined,
                    email: formData.email !== user.email ? formData.email : undefined,
                    current_password: formData.current_password,
                    new_password: formData.new_password || undefined
                })
            });

            const data = await res.json();
            if (res.ok) {
                toast.success('Profile updated successfully');
                updateUser({
                    username: formData.username,
                    email: formData.email,
                });
                const securityRes = await fetch('/api/auth/security-log?limit=10', {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                    },
                });
                if (securityRes.ok) {
                    setSecurityLog(await securityRes.json());
                }
                // Reset password fields
                setFormData(prev => ({ ...prev, current_password: '', new_password: '', confirm_password: '' }));
            } else {
                toast.error(data.detail || 'Failed to update profile');
            }
        } catch {
            toast.error('Communication error with server');
        } finally {
            setLoading(false);
        }
    };

    const formatEventLabel = (value) => value.replace(/_/g, ' ');

    const getStatusChipSx = (status) => {
        const color = status === 'success' ? '#87FF65' : status === 'failed' ? '#FF7A7A' : '#FFD447';

        return {
            color,
            borderColor: alpha(color, 0.34),
            backgroundColor: alpha(color, 0.12),
        };
    };

    return (
        <Box className="section-shell" sx={{ maxWidth: 1100, mx: 'auto' }}>
            <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
                Profile Settings
            </Typography>

            <Stack spacing={3} sx={{ maxWidth: 760, mx: 'auto' }}>
                <Paper sx={{ p: 3, borderRadius: 4, boxShadow: `0 0 24px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.1)}` }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                        <PersonIcon color="primary" sx={{ mr: 1 }} />
                        <Typography variant="h6">General Information</Typography>
                    </Box>
                    <form onSubmit={handleUpdate}>
                        <TextField
                            fullWidth
                            label="Username"
                            name="username"
                            value={formData.username}
                            onChange={handleChange}
                            margin="normal"
                        />
                        <TextField
                            fullWidth
                            label="Email"
                            name="email"
                            type="email"
                            value={formData.email}
                            onChange={handleChange}
                            margin="normal"
                        />

                        <Divider sx={{ my: 3 }} />

                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
                            <SecurityIcon color="primary" sx={{ mr: 1 }} />
                            <Typography variant="h6">Security & Password</Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                            To update your profile or change password, please provide your current password.
                        </Typography>

                        <TextField
                            fullWidth
                            label="New Password (optional)"
                            name="new_password"
                            type="password"
                            value={formData.new_password}
                            onChange={handleChange}
                            margin="normal"
                        />
                        <TextField
                            fullWidth
                            label="Confirm New Password"
                            name="confirm_password"
                            type="password"
                            value={formData.confirm_password}
                            onChange={handleChange}
                            margin="normal"
                        />

                        <TextField
                            fullWidth
                            required
                            label="Current Password"
                            name="current_password"
                            type="password"
                            value={formData.current_password}
                            onChange={handleChange}
                            margin="normal"
                            sx={{ mt: 2 }}
                        />

                        <Button
                            type="submit"
                            variant="contained"
                            fullWidth
                            disabled={loading}
                            sx={{ mt: 4, py: 1.5 }}
                        >
                            {loading ? <CircularProgress size={24} color="inherit" /> : 'Save Changes'}
                        </Button>
                    </form>
                </Paper>

                <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper', boxShadow: `0 0 24px ${alpha(theme.palette.secondary.main, theme.palette.mode === 'dark' ? 0.08 : 0.1)}` }}>
                    <Typography className="industrial-kicker" sx={{ mb: 0.5 }}>Telemetry</Typography>
                    <Typography variant="h6" gutterBottom>Account Metadata</Typography>
                    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                        <Box>
                            <Typography variant="caption" color="text.secondary" display="block">USER ID</Typography>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', letterSpacing: '0.08em' }}>{user?.id}</Typography>
                        </Box>

                        <Box>
                            <Typography variant="caption" color="text.secondary" display="block">MEMBER SINCE</Typography>
                            <Typography variant="body2">{new Date(user?.created_at).toLocaleDateString()}</Typography>
                        </Box>

                        <Box>
                            <Typography variant="caption" color="text.secondary" display="block">ACCOUNT TYPE</Typography>
                            <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 700, textShadow: `0 0 16px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.12)}` }}>Personal account</Typography>
                        </Box>

                        <Box>
                            <Typography variant="caption" color="text.secondary" display="block">ROLE</Typography>
                            <Typography variant="body2" sx={{ color: user?.role === 'admin' ? 'secondary.main' : 'primary.main', fontWeight: 700 }}>
                                {user?.role || 'user'}
                            </Typography>
                        </Box>
                    </Stack>
                </Paper>

                <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper', boxShadow: `0 0 24px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.1)}` }}>
                    <Typography className="industrial-kicker" sx={{ mb: 0.5 }}>Security</Typography>
                    <Typography variant="h6" gutterBottom>Recent Security Activity</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.75 }}>
                        Recent authentication and account events for this profile.
                    </Typography>

                    {securityLoading ? (
                        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                            <CircularProgress size={28} />
                        </Box>
                    ) : securityLog.length ? (
                        <Stack spacing={1}>
                            {securityLog.map((entry) => (
                                <Box key={entry.id} sx={{ p: 1.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.02 : 0.03) }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.25, mb: 0.75 }}>
                                        <Box>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'capitalize', lineHeight: 1.3 }}>
                                                {formatEventLabel(entry.event_type)}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown time'}
                                            </Typography>
                                        </Box>
                                        <Chip size="small" label={entry.status} variant="outlined" sx={getStatusChipSx(entry.status)} />
                                    </Box>
                                    {entry.ip_address ? (
                                        <Typography variant="body2" color="text.secondary">
                                            IP: {entry.ip_address}
                                        </Typography>
                                    ) : null}
                                    {entry.details && Object.keys(entry.details).length ? (
                                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, wordBreak: 'break-word' }}>
                                            {Object.entries(entry.details).map(([key, value]) => `${formatEventLabel(key)}: ${String(value)}`).join(' • ')}
                                        </Typography>
                                    ) : null}
                                </Box>
                            ))}
                        </Stack>
                    ) : (
                        <Typography color="text.secondary">No recent security activity recorded yet.</Typography>
                    )}
                </Paper>
            </Stack>
        </Box>
    );
};

export default Profile;
