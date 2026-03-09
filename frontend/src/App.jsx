import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Box, CircularProgress } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { Toaster } from 'sonner';

import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';
import Vehicles from './components/Vehicles';
import ListChargingSessions from './components/ListChargingSessions';
import Analytics from './components/Analytics';

const PrivateRoute = ({ children }) => {
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
};

function App() {
  const [themeMode, setThemeMode] = useState('dark');
  const [loading, setLoading] = useState(true);

  const theme = useMemo(() => createTheme({
    palette: {
      mode: themeMode,
      primary: { main: '#00F5FF' },
      secondary: { main: '#FF00E5' },
      background: {
        default: themeMode === 'dark' ? '#0A0A0B' : '#F4F7F9',
        paper: themeMode === 'dark' ? '#141416' : '#FFFFFF',
      },
    },
    shape: { borderRadius: 16 },
    typography: { fontFamily: "'Inter', sans-serif" },
  }), [themeMode]);

  useEffect(() => {
    const fetchUser = async () => {
      const token = localStorage.getItem('token');
      if (!token) { setLoading(false); return; }
      try {
        const res = await fetch('/api/auth/me', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const user = await res.json();
          if (user.theme_mode) setThemeMode(user.theme_mode);
        }
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    fetchUser();
  }, []);

  const toggleTheme = async () => {
    const newMode = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(newMode);
    const token = localStorage.getItem('token');
    if (token) {
      await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ theme_mode: newMode })
      });
    }
  };

  if (loading) return <Box display="flex" justifyContent="center" alignItems="center" height="100vh"><CircularProgress /></Box>;

  return (
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <CssBaseline />
        <Toaster position="top-center" richColors theme={themeMode} />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthPage mode="login" />} />
            <Route path="/register" element={<AuthPage mode="register" />} />
            <Route path="/*" element={
              <PrivateRoute>
                <Box sx={{ display: 'flex', minHeight: '100vh', flexDirection: { xs: 'column', sm: 'row' } }}>
                  <Sidebar toggleTheme={toggleTheme} themeMode={themeMode} />
                  <Box component="main" sx={{ 
                    flexGrow: 1, 
                    p: { xs: 2, sm: 3 }, 
                    pb: { xs: 10, sm: 3 }, 
                    width: '100%',
                    maxWidth: '1200px',
                    mx: 'auto'
                  }}>
                    <Routes>
                      <Route path="/" element={<Dashboard />} />
                      <Route path="/vehicles" element={<Vehicles />} />
                      <Route path="/sessions" element={<ListChargingSessions />} />
                      <Route path="/analytics" element={<Analytics />} />
                    </Routes>
                  </Box>
                  <MobileNav />
                </Box>
              </PrivateRoute>
            } />
          </Routes>
        </BrowserRouter>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

export default App;
