import React, { useEffect, useState } from 'react';
import { Box, TextField, Button, Typography, Paper, Container, Tab, Tabs, Stack, Chip, Link, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAuth } from '../context/useAuth';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

const AuthPage = ({ mode = 'login' }) => {
    const [tab, setTab] = useState(mode === 'register' ? 1 : 0);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const { login, authenticated } = useAuth();
    const navigate = useNavigate();
    const theme = useTheme();

    useEffect(() => {
        setTab(mode === 'register' ? 1 : 0);
    }, [mode]);

    useEffect(() => {
        if (authenticated) {
            navigate('/');
        }
    }, [authenticated, navigate]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const endpoint = tab === 0 ? '/api/auth/login' : '/api/auth/register';
        const body = tab === 0 ? { email, password } : { username, email, password };
        
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (res.ok) {
                if (tab === 0) {
                    login(data.user, data.access_token, data.refresh_token);
                    toast.success(`Welcome back, ${data.user.username}!`);
                    navigate('/');
                } else {
                    toast.success('Account created. You can sign in now.');
                    setPassword('');
                    navigate('/login');
                }
            } else {
                toast.error(data.detail || data.error || 'Something went wrong');
            }
        } catch {
            toast.error('Connection error');
        }
    };

    const handleTabChange = (event, value) => {
        setTab(value);
        navigate(value === 0 ? '/login' : '/register');
    };

    return (
        <Box className="auth-shell">
            <Container maxWidth="lg">
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', md: '1.1fr 0.9fr' },
                        gap: 3,
                        alignItems: 'stretch',
                    }}
                >
                    <Paper
                        sx={{
                            p: { xs: 3, md: 4 },
                            borderRadius: 4,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            minHeight: { xs: 260, md: 620 },
                            position: 'relative',
                            overflow: 'hidden',
                        }}
                    >
                                                <Box
                                                    sx={{
                                                        position: 'absolute',
                                                        inset: 0,
                                                        opacity: theme.palette.mode === 'dark' ? 0.2 : 0.3,
                                                        pointerEvents: 'none',
                                                        backgroundImage: `linear-gradient(${alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.05)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.08 : 0.05)} 1px, transparent 1px)`,
                                                        backgroundSize: '32px 32px',
                                                    }}
                                                />
                        <Box sx={{ position: 'relative' }}>
                            <Typography className="industrial-kicker">Industrial Ops Dashboard</Typography>
                            <Typography className="industrial-title">GarageOS Control</Typography>
                            <Typography className="industrial-subtitle">
                                Track charging, service, insurance, and every operational cost from a darker, sharper command surface built for daily use.
                            </Typography>
                        </Box>

                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 3, position: 'relative' }}>
                            <Chip label="Neon dark shell" color="primary" variant="outlined" />
                            <Chip label="Vehicle cost intelligence" color="secondary" variant="outlined" />
                            <Chip label="Single-user control" variant="outlined" />
                        </Stack>

                        <Box
                            sx={{
                                position: 'relative',
                                display: 'grid',
                                gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
                                gap: 2,
                                mt: 4,
                            }}
                        >
                            {[
                                ['Live Cost Feed', 'Sessions and expenses in one activity rail'],
                                ['Steel + Neon UI', 'Industrial framing with cyan and magenta edge lighting'],
                                ['Fast Entry Flow', 'Designed for quick logging on desktop and mobile'],
                            ].map(([title, text]) => (
                                <Box
                                    key={title}
                                    sx={{
                                        p: 2,
                                        borderRadius: 2,
                                        bgcolor: alpha(theme.palette.common.white, theme.palette.mode === 'dark' ? 0.04 : 0.4),
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        boxShadow: `0 0 22px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.06)}`,
                                    }}
                                >
                                    <Typography variant="h6" sx={{ fontSize: '1rem', mb: 0.5 }}>{title}</Typography>
                                    <Typography variant="body2" color="text.secondary">{text}</Typography>
                                </Box>
                            ))}
                        </Box>
                    </Paper>

                    <Paper sx={{ p: { xs: 3, md: 4 }, borderRadius: 4, alignSelf: 'center' }}>
                        <Typography className="industrial-kicker">Access Node</Typography>
                        <Typography variant="h5" sx={{ mb: 1 }}>Secure Entry</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            Use your email identity to enter the operational dashboard.
                        </Typography>

                        <Tabs value={tab} onChange={handleTabChange} centered sx={{ mb: 3 }}>
                            <Tab label="Sign In" />
                            <Tab label="Register" />
                        </Tabs>

                        <form onSubmit={handleSubmit}>
                            <Stack spacing={2}>
                                {tab === 1 && (
                                    <TextField
                                        fullWidth
                                        label="Display Name"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                    />
                                )}
                                <TextField
                                    fullWidth
                                    label="Email"
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                />
                                <TextField
                                    fullWidth
                                    label="Password"
                                    type="password"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                                <Button type="submit" fullWidth variant="contained" sx={{ mt: 1, py: 1.6 }}>
                                    {tab === 0 ? 'Sign In' : 'Create Account'}
                                </Button>
                                {tab === 0 ? (
                                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <Link
                                            component="button"
                                            type="button"
                                            underline="hover"
                                            color="primary"
                                            onClick={() => navigate('/forgot-password')}
                                            sx={{ fontWeight: 600, letterSpacing: '0.04em' }}
                                        >
                                            Forgot password?
                                        </Link>
                                    </Box>
                                ) : null}
                            </Stack>
                        </form>
                    </Paper>
                </Box>
            </Container>
        </Box>
    );
};

export default AuthPage;
