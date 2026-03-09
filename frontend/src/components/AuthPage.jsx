import React, { useState } from 'react';
import { Box, TextField, Button, Typography, Paper, Container, Tab, Tabs } from '@mui/material';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';

const AuthPage = () => {
    const [tab, setTab] = useState(0);
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const { login } = useAuth();

    const handleSubmit = async (e) => {
        e.preventDefault();
        const endpoint = tab === 0 ? '/api/auth/login' : '/api/auth/register';
        const body = tab === 0 ? { username, password } : { username, email, password };
        
        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (res.ok) {
                if (tab === 0) {
                    login(data.user, data.access_token);
                    toast.success(`Welcome back, ${data.user.username}!`);
                } else {
                    setTab(0);
                    toast.success("Registered successfully. Please login.");
                }
            } else {
                toast.error(data.detail || data.error || "Something went wrong");
            }
        } catch (err) {
            toast.error("Connection error");
        }
    };

    return (
        <Container maxWidth="xs" sx={{ height: '100vh', display: 'flex', alignItems: 'center' }}>
            <Paper elevation={3} sx={{ p: 4, width: '100%', borderRadius: 4 }}>
                <Typography variant="h5" textAlign="center" gutterBottom>
                    MICRO SAAS EV
                </Typography>
                <Tabs value={tab} onChange={(e, v) => setTab(v)} centered sx={{ mb: 2 }}>
                    <Tab label="Login" />
                    <Tab label="Register" />
                </Tabs>
                <form onSubmit={handleSubmit}>
                    <TextField 
                        fullWidth label="Username" margin="normal" 
                        value={username} onChange={(e) => setUsername(e.target.value)} 
                    />
                    {tab === 1 && (
                        <TextField 
                            fullWidth label="Email" margin="normal" 
                            value={email} onChange={(e) => setEmail(e.target.value)} 
                        />
                    )}
                    <TextField 
                        fullWidth label="Password" type="password" margin="normal" 
                        value={password} onChange={(e) => setPassword(e.target.value)} 
                    />
                    <Button type="submit" fullWidth variant="contained" sx={{ mt: 3, py: 1.5 }}>
                        {tab === 0 ? "Login" : "Sign Up"}
                    </Button>
                </form>
            </Paper>
        </Container>
    );
};

export default AuthPage;
