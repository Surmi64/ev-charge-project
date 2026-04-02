import React, { lazy, Suspense, useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Box, CircularProgress } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { Toaster } from 'sonner';
import './App.css';

import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import { useAuth } from './context/useAuth';

const AuthPage = lazy(() => import('./components/AuthPage'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const Vehicles = lazy(() => import('./components/Vehicles'));
const ListChargingSessions = lazy(() => import('./components/ListChargingSessions'));
const Analytics = lazy(() => import('./components/Analytics'));
const Profile = lazy(() => import('./components/Profile'));
const Expenses = lazy(() => import('./components/Expenses'));
const Activity = lazy(() => import('./components/Activity'));
const UserManagement = lazy(() => import('./components/UserManagement'));
const PasswordRecoveryPage = lazy(() => import('./components/PasswordRecoveryPage'));

const PageLoader = () => (
  <Box
    display="flex"
    justifyContent="center"
    alignItems="center"
    minHeight="50vh"
    sx={{
      border: '1px solid',
      borderColor: 'divider',
      borderRadius: 3,
      bgcolor: 'background.paper',
      boxShadow: '0 0 24px rgba(0, 245, 255, 0.12)',
    }}
  >
    <CircularProgress size={42} thickness={3} />
  </Box>
);

const PrivateRoute = ({ children }) => {
  const { authenticated, loading } = useAuth();

  if (loading) {
    return <Box display="flex" justifyContent="center" alignItems="center" height="100vh"><CircularProgress /></Box>;
  }

  return authenticated ? children : <Navigate to="/login" replace />;
};

const AdminRoute = ({ children }) => {
  const { authenticated, loading, user } = useAuth();

  if (loading) {
    return <Box display="flex" justifyContent="center" alignItems="center" height="100vh"><CircularProgress /></Box>;
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
};

function App() {
  const { token, user, updateUser, loading } = useAuth();
  const [themeMode, setThemeMode] = useState('dark');

  const theme = useMemo(() => {
    const darkMode = themeMode === 'dark';
    const primaryMain = darkMode ? '#00F5FF' : '#0F8FA5';
    const secondaryMain = darkMode ? '#FF00E5' : '#C3479F';
    const successMain = darkMode ? '#87FF65' : '#2F8F59';
    const backgroundDefault = darkMode ? '#070B0F' : '#EEF3F6';
    const backgroundPaper = darkMode ? 'rgba(12, 18, 24, 0.82)' : 'rgba(255, 255, 255, 0.78)';
    const lineColor = darkMode ? 'rgba(185, 214, 231, 0.12)' : 'rgba(31, 51, 64, 0.12)';
    const textPrimary = darkMode ? '#EDF7FF' : '#0B141A';
    const textSecondary = darkMode ? 'rgba(228, 236, 243, 0.68)' : 'rgba(36, 51, 63, 0.74)';
    const surfaceBlur = darkMode ? 'blur(10px)' : 'blur(10px)';
    const paperShadow = darkMode
      ? '0 12px 26px rgba(0, 0, 0, 0.24)'
      : '0 18px 38px rgba(28, 45, 56, 0.08), 0 0 0 1px rgba(255, 255, 255, 0.6) inset';
    const cardShadow = darkMode
      ? `0 0 0 1px ${alpha('#FFFFFF', 0.03)} inset, 0 0 14px ${alpha(primaryMain, 0.05)}, 0 10px 22px rgba(0, 0, 0, 0.24)`
      : `0 18px 34px rgba(27, 43, 54, 0.08), 0 0 0 1px ${alpha('#FFFFFF', 0.72)} inset, 0 0 0 1px ${alpha(primaryMain, 0.05)}`;

    return createTheme({
      palette: {
        mode: themeMode,
        primary: { main: primaryMain },
        secondary: { main: secondaryMain },
        success: { main: successMain },
        background: {
          default: backgroundDefault,
          paper: backgroundPaper,
        },
        divider: lineColor,
        text: {
          primary: textPrimary,
          secondary: textSecondary,
        },
      },
      transitions: {
        duration: {
          shortest: 90,
          shorter: 120,
          short: 160,
          standard: 180,
          complex: 220,
          enteringScreen: 180,
          leavingScreen: 140,
        },
      },
      shape: { borderRadius: 2 },
      typography: {
        fontFamily: '"IBM Plex Sans", sans-serif',
        h3: {
          fontFamily: '"Rajdhani", sans-serif',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        },
        h4: {
          fontFamily: '"Rajdhani", sans-serif',
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        },
        h5: {
          fontFamily: '"Rajdhani", sans-serif',
          fontWeight: 700,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
        },
        h6: {
          fontFamily: '"Rajdhani", sans-serif',
          fontWeight: 700,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
        },
        button: {
          fontFamily: '"Rajdhani", sans-serif',
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              backgroundImage: darkMode
                ? [
                    'radial-gradient(circle at 10% 0%, rgba(0, 245, 255, 0.14), transparent 22%)',
                    'radial-gradient(circle at 90% 18%, rgba(255, 0, 229, 0.12), transparent 18%)',
                    'linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 16%)',
                  ].join(',')
                : [
                    'repeating-linear-gradient(90deg, rgba(27, 43, 54, 0.03) 0 1px, transparent 1px 96px)',
                    'radial-gradient(circle at 12% 0%, rgba(15, 143, 165, 0.08), transparent 24%)',
                    'radial-gradient(circle at 88% 14%, rgba(195, 71, 159, 0.08), transparent 20%)',
                    'linear-gradient(145deg, rgba(255, 255, 255, 0.82), rgba(232, 239, 243, 0.98))',
                  ].join(','),
            },
            '*': {
              WebkitTapHighlightColor: 'transparent',
            },
          },
        },
        MuiButtonBase: {
          defaultProps: {
            disableRipple: true,
            disableTouchRipple: true,
          },
        },
        MuiPaper: {
          styleOverrides: {
            root: {
              backdropFilter: surfaceBlur,
              border: `1px solid ${lineColor}`,
              boxShadow: paperShadow,
              backgroundImage: darkMode
                ? `linear-gradient(145deg, ${alpha('#FFFFFF', 0.04)}, ${alpha('#FFFFFF', 0.01)})`
                : `linear-gradient(145deg, ${alpha('#FFFFFF', 0.92)}, ${alpha('#E8F0F4', 0.74)})`,
              transition: 'box-shadow 140ms ease, border-color 140ms ease, background-color 140ms ease',
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              backdropFilter: surfaceBlur,
              border: `1px solid ${darkMode ? alpha(primaryMain, 0.18) : alpha('#0F1A22', 0.1)}`,
              backgroundImage: darkMode
                ? `linear-gradient(145deg, ${alpha('#FFFFFF', 0.04)}, ${alpha('#FFFFFF', 0.015)})`
                : `linear-gradient(145deg, ${alpha('#FFFFFF', 0.96)}, ${alpha('#EEF4F7', 0.82)})`,
              boxShadow: cardShadow,
              transition: 'box-shadow 140ms ease, border-color 140ms ease, background-color 140ms ease',
            },
          },
        },
        MuiButton: {
          styleOverrides: {
            root: {
              borderRadius: 6,
              paddingInline: '1.15rem',
              boxShadow: 'none',
              transition: 'transform 100ms ease, background-color 120ms ease, border-color 120ms ease, color 120ms ease',
            },
            contained: {
              backgroundImage: `linear-gradient(135deg, ${primaryMain}, ${secondaryMain})`,
              color: darkMode ? '#061015' : '#F7FBFC',
              boxShadow: darkMode ? `0 0 12px ${alpha(primaryMain, 0.22)}` : `0 10px 20px ${alpha(primaryMain, 0.18)}`,
            },
            outlined: {
              borderColor: darkMode ? alpha(primaryMain, 0.45) : alpha(primaryMain, 0.24),
              backgroundColor: darkMode ? 'transparent' : alpha('#FFFFFF', 0.48),
              '&:hover': {
                borderColor: primaryMain,
                backgroundColor: darkMode ? alpha(primaryMain, 0.08) : alpha(primaryMain, 0.08),
              },
            },
          },
        },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: 4,
              backgroundColor: darkMode ? alpha('#081017', 0.68) : alpha('#FFFFFF', 0.82),
              transition: 'border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease',
              '& fieldset': {
                borderColor: darkMode ? alpha(primaryMain, 0.22) : alpha(primaryMain, 0.16),
              },
              '&:hover fieldset': {
                borderColor: darkMode ? alpha(primaryMain, 0.45) : alpha(primaryMain, 0.24),
              },
              '&.Mui-focused fieldset': {
                borderColor: primaryMain,
                boxShadow: darkMode ? `0 0 0 1px ${alpha(primaryMain, 0.16)}, 0 0 10px ${alpha(primaryMain, 0.12)}` : `0 0 0 1px ${alpha(primaryMain, 0.14)}`,
              },
            },
            input: {
              fontSize: '0.95rem',
            },
          },
        },
        MuiTabs: {
          styleOverrides: {
            indicator: {
              height: 3,
              borderRadius: 2,
              backgroundImage: `linear-gradient(90deg, ${primaryMain}, ${secondaryMain})`,
              boxShadow: darkMode ? `0 0 10px ${alpha(primaryMain, 0.26)}` : 'none',
            },
          },
        },
        MuiTab: {
          styleOverrides: {
            root: {
              minHeight: 44,
              fontFamily: '"Rajdhani", sans-serif',
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            },
          },
        },
        MuiChip: {
          styleOverrides: {
            root: {
              borderRadius: 4,
              fontWeight: 600,
              letterSpacing: '0.04em',
            },
          },
        },
        MuiTableCell: {
          styleOverrides: {
            head: {
              borderBottomColor: lineColor,
              color: darkMode ? alpha('#EAF7FF', 0.86) : alpha(textPrimary, 0.82),
              fontFamily: '"Rajdhani", sans-serif',
              fontSize: '0.82rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            },
            body: {
              borderBottomColor: lineColor,
            },
          },
        },
        MuiDialog: {
          styleOverrides: {
            paper: {
              borderRadius: 8,
              boxShadow: darkMode ? `0 0 18px ${alpha(primaryMain, 0.08)}, 0 14px 34px rgba(0, 0, 0, 0.3)` : '0 18px 38px rgba(22, 37, 48, 0.12)',
            },
          },
        },
        MuiBottomNavigation: {
          styleOverrides: {
            root: {
              background: 'transparent',
            },
          },
        },
        MuiBottomNavigationAction: {
          styleOverrides: {
            root: {
              minWidth: 'auto',
              color: textSecondary,
              transition: 'color 120ms ease, transform 100ms ease',
              '&.Mui-selected': {
                color: primaryMain,
              },
            },
            label: {
              fontFamily: '"Rajdhani", sans-serif',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            },
          },
        },
      },
    });
  }, [themeMode]);

  useEffect(() => {
    if (user?.theme_mode) {
      setThemeMode(user.theme_mode);
    }
  }, [user]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    document.documentElement.style.colorScheme = themeMode;
    document.body.setAttribute('data-theme', themeMode);
  }, [themeMode]);

  const toggleTheme = async () => {
    const newMode = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(newMode);
    if (token) {
      await fetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ theme_mode: newMode })
      });
      updateUser({ theme_mode: newMode });
    }
  };

  if (loading) return <Box display="flex" justifyContent="center" alignItems="center" height="100vh"><CircularProgress size={48} thickness={3} /></Box>;

  return (
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <CssBaseline />
        <Toaster position="top-center" richColors theme={themeMode} />
        <Box className="app-shell">
          <BrowserRouter>
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/register" element={<AuthPage mode="register" />} />
                <Route path="/forgot-password" element={<PasswordRecoveryPage mode="forgot" />} />
                <Route path="/reset-password" element={<PasswordRecoveryPage mode="reset" />} />
                <Route path="/*" element={
                  <PrivateRoute>
                    <Box sx={{ display: 'flex', minHeight: '100vh', flexDirection: { xs: 'column', sm: 'row' } }}>
                      <Sidebar toggleTheme={toggleTheme} themeMode={themeMode} />
                      <Box
                        component="main"
                        className="industrial-main"
                        sx={{
                          flexGrow: 1,
                          p: { xs: 2, sm: 3 },
                          pb: { xs: 11, sm: 4 },
                          width: '100%',
                        }}
                      >
                        <Box sx={{ width: '100%', maxWidth: '1320px', mx: 'auto' }}>
                          <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/vehicles" element={<Vehicles />} />
                            <Route path="/activity" element={<Activity />} />
                            <Route path="/sessions" element={<ListChargingSessions />} />
                            <Route path="/expenses" element={<Expenses />} />
                            <Route path="/analytics" element={<Analytics />} />
                            <Route path="/account" element={<Profile />} />
                            <Route path="/admin/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
                          </Routes>
                        </Box>
                      </Box>
                      <MobileNav />
                    </Box>
                  </PrivateRoute>
                } />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </Box>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

export default App;
