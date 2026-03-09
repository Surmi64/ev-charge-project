import React, { useState, useEffect } from 'react';
import { Box, Paper, Typography, TextField, Button, Grid, Divider, CircularProgress } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import PersonIcon from '@mui/icons-material/Person';
import SecurityIcon from '@mui/icons-material/Security';

const Profile = () => {
    const { token, user, login } = useAuth();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        username: user?.username || '',
        email: user?.email || '',
        current_password: '',
        new_password: '',
        confirm_password: ''
    });

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
                // Reset password fields
                setFormData(prev => ({ ...prev, current_password: '', new_password: '', confirm_password: '' }));
            } else {
                toast.error(data.detail || 'Failed to update profile');
            }
        } catch (err) {
            toast.error('Communication error with server');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ maxWidth: 800, mx: 'auto', mt: 4 }}>
            <Typography variant="h4" gutterBottom fontWeight={800}>Profile Settings</Typography>
            
            <Grid container spacing={3}>
                <Grid item xs={12} md={7}>
                    <Paper sx={{ p: 3, borderRadius: 3 }}>
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
                            
                            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
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
                </Grid>

                <Grid item xs={12} md={5}>
                    <Paper sx={{ p: 3, borderRadius: 3, bgcolor: 'background.paper', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <Typography variant="h6" gutterBottom>Account Metadata</Typography>
                        <Box sx={{ mt: 2 }}>
                            <Typography variant="caption" color="text.secondary" display="block">USER ID</Typography>
                            <Typography variant="body2" gutterBottom mono="true">{user?.id}</Typography>
                            
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>MEMBER SINCE</Typography>
                            <Typography variant="body2">{new Date(user?.created_at).toLocaleDateString()}</Typography>
                            
                            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>SUBSCRIPTION</Typography>
                            <Typography variant="body2" sx={{ color: 'primary.main', fontWeight: 600 }}>Micro SaaS Free Tier</Typography>
                        </Box>
                    </Paper>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Profile;
