// Routes are imported directly rather than lazily. Each page chunk was only a few
// kB gzipped (27 kB for all of them, against 220 kB of MUI and Recharts that load
// regardless), but every navigation paid for it with a Suspense fallback that
// appeared and vanished inside ~50 ms. That flicker was the 'jumping'.
import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, createTheme, CssBaseline, Box, CircularProgress, useMediaQuery } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { Toaster } from 'sonner';
import './App.css';

import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import SubscriptionBanner from './components/SubscriptionBanner';
import Onboarding from './components/Onboarding';
import AuthPage from './components/AuthPage';
import Dashboard from './components/Dashboard';
import Vehicles from './components/Vehicles';
import Analytics from './components/Analytics';
import Profile from './components/Profile';
import Activity from './components/Activity';
import AdminPage from './components/AdminPage';
import PasswordRecoveryPage from './components/PasswordRecoveryPage';
import Billing from './components/Billing';
import { useAuth } from './context/useAuth';
import { BRAND, SURFACE, ON_BRAND } from './utils/palette';



const PrivateRoute = ({ children }) => {
  const { authenticated, loading, user } = useAuth();

  if (loading) {
    return <Box display="flex" justifyContent="center" alignItems="center" height="100dvh"><CircularProgress /></Box>;
  }

  if (!authenticated) return <Navigate to="/login" replace />;

  // Shown once per account, on any route. Skipping sets the same flag as finishing,
  // so this never comes back.
  if (user && !user.onboarded_at) return <Onboarding />;

  return children;
};

const AdminRoute = ({ children }) => {
  const { authenticated, loading, user } = useAuth();

  if (loading) {
    return <Box display="flex" justifyContent="center" alignItems="center" height="100dvh"><CircularProgress /></Box>;
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  return user?.role === 'admin' ? children : <Navigate to="/" replace />;
};

function App() {
  const { token, user, updateUser, loading } = useAuth();
  const [themeMode, setThemeMode] = useState('dark');
  const prefersReducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const theme = useMemo(() => {
    const darkMode = themeMode === 'dark';
    // Every colour here comes from utils/palette.js. Light-mode brand values are
    // darkened so they clear WCAG AA (4.5:1) both as text on a light surface and as
    // a button background under the ON_BRAND label ink; the pre-contrast values
    // (#0F8FA5 / #C3479F / #2F8F59) sat at 3.7:1 / 4.3:1 / 4.0:1.
    //
    // warning and error used to fall through to MUI's Material orange and red,
    // which were the only two colours in the app that belonged to no palette.
    // They are now the brand amber and red, the same hues the charts use.
    const brand = BRAND[themeMode];
    const surface = SURFACE[themeMode];
    const onBrand = ON_BRAND[themeMode];
    const primaryMain = brand.cyan;
    const secondaryMain = brand.magenta;
    const backgroundDefault = surface.background;
    const backgroundPaper = surface.paper;
    const lineColor = surface.line;
    const textPrimary = surface.textPrimary;
    const textSecondary = surface.textSecondary;
    const surfaceBlur = darkMode ? 'blur(10px)' : 'blur(10px)';
    const paperShadow = darkMode
      ? `0 12px 26px rgba(${surface.shadow}, 0.24)`
      : `0 18px 38px rgba(${surface.shadow}, 0.08), 0 0 0 1px ${alpha(surface.sheen, 0.6)} inset`;
    const cardShadow = darkMode
      ? `0 0 0 1px ${alpha(surface.sheen, 0.03)} inset, 0 0 14px ${alpha(primaryMain, 0.05)}, 0 10px 22px rgba(${surface.shadow}, 0.24)`
      : `0 18px 34px rgba(${surface.shadow}, 0.08), 0 0 0 1px ${alpha(surface.sheen, 0.72)} inset, 0 0 0 1px ${alpha(primaryMain, 0.05)}`;

    return createTheme({
      palette: {
        mode: themeMode,
        primary: { main: primaryMain },
        secondary: { main: secondaryMain },
        success: { main: brand.green },
        warning: { main: brand.amber },
        error: { main: brand.red },
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
        // Collapse every MUI transition to ~0 when the OS asks for reduced motion.
        // index.css carries the same rule for plain CSS; Recharts is handled per-chart
        // via isAnimationActive, since its animation is JS-driven and ignores CSS.
        duration: prefersReducedMotion
          ? {
              shortest: 0,
              shorter: 0,
              short: 0,
              standard: 0,
              complex: 0,
              enteringScreen: 0,
              leavingScreen: 0,
            }
          : {
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
        fontFamily: `"IBM Plex Sans", system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`,
        h3: {
          fontFamily: `"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        },
        h4: {
          fontFamily: `"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`,
          fontWeight: 700,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        },
        h5: {
          fontFamily: `"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`,
          fontWeight: 700,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
        },
        h6: {
          fontFamily: `"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`,
          fontWeight: 700,
          letterSpacing: '0.03em',
          textTransform: 'uppercase',
        },
        button: {
          fontFamily: `"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`,
          fontWeight: 700,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        },
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            body: {
              // The light wash used to be mixed from #0F8FA5 / #C3479F, the brand
              // values from before the contrast pass -- close enough to look
              // deliberate, far enough to be a second light brand.
              backgroundImage: darkMode
                ? [
                    `radial-gradient(circle at 10% 0%, ${alpha(primaryMain, 0.14)}, transparent 22%)`,
                    `radial-gradient(circle at 90% 18%, ${alpha(secondaryMain, 0.12)}, transparent 18%)`,
                    `linear-gradient(180deg, ${alpha(surface.sheen, 0.02)}, transparent 16%)`,
                  ].join(',')
                : [
                    'repeating-linear-gradient(90deg, rgba(27, 43, 54, 0.03) 0 1px, transparent 1px 96px)',
                    `radial-gradient(circle at 12% 0%, ${alpha(primaryMain, 0.08)}, transparent 24%)`,
                    `radial-gradient(circle at 88% 14%, ${alpha(secondaryMain, 0.08)}, transparent 20%)`,
                    `linear-gradient(145deg, ${alpha(surface.sheen, 0.82)}, ${alpha(surface.tint, 0.98)})`,
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
                ? `linear-gradient(145deg, ${alpha(surface.sheen, 0.04)}, ${alpha(surface.sheen, 0.01)})`
                : `linear-gradient(145deg, ${alpha(surface.sheen, 0.92)}, ${alpha(surface.tint, 0.74)})`,
              transition: 'box-shadow 140ms ease, border-color 140ms ease, background-color 140ms ease',
            },
          },
        },
        MuiCard: {
          styleOverrides: {
            root: {
              backdropFilter: surfaceBlur,
              border: `1px solid ${darkMode ? alpha(primaryMain, 0.18) : alpha(textPrimary, 0.1)}`,
              backgroundImage: darkMode
                ? `linear-gradient(145deg, ${alpha(surface.sheen, 0.04)}, ${alpha(surface.sheen, 0.015)})`
                : `linear-gradient(145deg, ${alpha(surface.sheen, 0.96)}, ${alpha(surface.tint, 0.82)})`,
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
              color: onBrand,
              boxShadow: darkMode ? `0 0 12px ${alpha(primaryMain, 0.22)}` : `0 10px 20px ${alpha(primaryMain, 0.18)}`,
            },
            // `contained` paints every filled button with the brand gradient regardless
            // of colour, which left destructive confirmations looking exactly like an
            // ordinary primary action -- delete a vehicle, delete a record, delete an
            // account. Measured with the same ink the gradient uses: #061015 on the
            // dark red is 7.6:1, #F7FBFC on the light red is 5.4:1.
            containedError: ({ theme: muiTheme }) => ({
              backgroundImage: 'none',
              backgroundColor: muiTheme.palette.error.main,
              color: onBrand,
              boxShadow: darkMode
                ? `0 0 12px ${alpha(muiTheme.palette.error.main, 0.3)}`
                : `0 10px 20px ${alpha(muiTheme.palette.error.main, 0.22)}`,
              '&:hover': { backgroundColor: muiTheme.palette.error.dark },
            }),
            outlined: {
              borderColor: darkMode ? alpha(primaryMain, 0.45) : alpha(primaryMain, 0.24),
              backgroundColor: darkMode ? 'transparent' : alpha(surface.sheen, 0.48),
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
              backgroundColor: darkMode ? alpha(surface.tint, 0.68) : alpha(surface.sheen, 0.82),
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
              fontFamily: `"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`,
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
              color: alpha(textPrimary, darkMode ? 0.86 : 0.82),
              fontFamily: `"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`,
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
              boxShadow: darkMode
                ? `0 0 18px ${alpha(primaryMain, 0.08)}, 0 14px 34px rgba(${surface.shadow}, 0.3)`
                : `0 18px 38px rgba(${surface.shadow}, 0.12)`,
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
              fontFamily: `"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif`,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            },
          },
        },
      },
    });
  }, [themeMode, prefersReducedMotion]);

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

  if (loading) return <Box display="flex" justifyContent="center" alignItems="center" height="100dvh"><CircularProgress size={48} thickness={3} /></Box>;

  return (
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <CssBaseline />
        <Toaster position="top-center" richColors theme={themeMode} />
        <Box className="app-shell">
          <BrowserRouter>
              <Routes>
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/register" element={<AuthPage mode="register" />} />
                <Route path="/forgot-password" element={<PasswordRecoveryPage mode="forgot" />} />
                <Route path="/reset-password" element={<PasswordRecoveryPage mode="reset" />} />
                <Route path="/*" element={
                  <PrivateRoute>
                    <Box sx={{ display: 'flex', minHeight: '100dvh', flexDirection: { xs: 'column', sm: 'row' } }}>
                      <Box component="a" href="#main-content" className="skip-link">
                        Skip to main content
                      </Box>
                      <Sidebar toggleTheme={toggleTheme} themeMode={themeMode} />
                      <Box
                        component="main"
                        id="main-content"
                        tabIndex={-1}
                        className="industrial-main"
                        sx={{
                          flexGrow: 1,
                          p: { xs: 2, sm: 3 },
                          // Bottom padding clears the fixed MobileNav (72px) plus the
                          // iOS home indicator, which the safe-area inset resolves to 0 on
                          // devices and browsers that do not have one.
                          pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', sm: 4 },
                          width: '100%',
                        }}
                      >
                        <Box sx={{ width: '100%', maxWidth: '1320px', mx: 'auto' }}>
                          <SubscriptionBanner />
                          <Routes>
                            <Route path="/" element={<Dashboard />} />
                            <Route path="/vehicles" element={<Vehicles />} />
                            <Route path="/activity" element={<Activity />} />
                            <Route path="/analytics" element={<Analytics />} />
                            <Route path="/account" element={<Profile />} />
                            <Route path="/billing" element={<Billing />} />
                            <Route path="/admin" element={<AdminRoute><AdminPage /></AdminRoute>} />
              {/* The old bookmark keeps working, landing on the tab it used to be. */}
              <Route path="/admin/users" element={<Navigate to="/admin?tab=users" replace />} />
                          </Routes>
                        </Box>
                      </Box>
                      <MobileNav />
                    </Box>
                  </PrivateRoute>
                } />
              </Routes>
          </BrowserRouter>
        </Box>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

export default App;
