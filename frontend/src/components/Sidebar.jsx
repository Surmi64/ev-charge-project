import React from 'react';
import { 
  Box, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Typography,
  Card,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { 
  Dashboard as DashIcon, 
  DirectionsCar as CarIcon, 
  Timeline as ActivityIcon,
  EvStation as ChargeIcon, 
  BarChart as AnalyticsIcon,
  Person as PersonIcon,
  AdminPanelSettings as AdminIcon,
  Logout as LogoutIcon,
  Brightness4 as DarkIcon,
  Brightness7 as LightIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

const Sidebar = ({ toggleTheme, themeMode }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const theme = useTheme();

  const menuItems = [
    { text: 'Dashboard', icon: <DashIcon />, path: '/' },
    { text: 'Vehicles', icon: <CarIcon />, path: '/vehicles' },
    { text: 'Activity', icon: <ActivityIcon />, path: '/activity' },
    { text: 'Analytics', icon: <AnalyticsIcon />, path: '/analytics' },
    { text: 'Account', icon: <PersonIcon />, path: '/account' },
  ];

  if (user?.role === 'admin') {
    menuItems.push({ text: 'User Management', icon: <AdminIcon />, path: '/admin/users' });
  }

  const isMenuItemSelected = (path) => {
    if (path === '/activity') {
      return ['/activity', '/sessions', '/expenses'].includes(location.pathname);
    }

    if (path === '/admin/users') {
      return location.pathname === '/admin/users';
    }

    return location.pathname === path;
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <Box sx={{ 
      width: 308, 
      flexShrink: 0,
      display: { xs: 'none', sm: 'flex' },
      flexDirection: 'column',
      p: 2.5,
      gap: 2,
      position: 'sticky',
      top: 0,
      height: '100vh'
    }}>
      <Box
        sx={{
          p: 2.5,
          borderRadius: 4,
          position: 'relative',
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          boxShadow: `0 0 14px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.12)}`,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ 
          width: 52,
          height: 52,
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '1px solid',
          borderColor: 'primary.main',
          background: `linear-gradient(135deg, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.12)}, ${alpha(theme.palette.secondary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1)})`,
          boxShadow: `0 0 10px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.16 : 0.12)}`
        }}>
          <ChargeIcon sx={{ color: 'primary.main', fontSize: 26 }} />
        </Box>
        <Typography variant="h5" sx={{ lineHeight: 0.9 }}>GarageOS</Typography>
        </Box>
      </Box>

      <Box sx={{ flexGrow: 1, border: '1px solid', borderColor: 'divider', borderRadius: 4, bgcolor: 'background.paper', p: 1.5 }}>
      <Typography className="industrial-kicker" sx={{ px: 1.25, pt: 0.5 }}>Navigation</Typography>
      <List sx={{ flexGrow: 1, mt: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
            <ListItemButton 
              onClick={() => navigate(item.path)}
              selected={isMenuItemSelected(item.path)}
              sx={{
                borderRadius: 1,
                px: 1.4,
                py: 1.15,
                border: '1px solid transparent',
                '&.Mui-selected': {
                  bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.1),
                  borderColor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.28 : 0.22),
                  boxShadow: `0 0 10px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.08 : 0.1)}`,
                  '&:hover': { bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.12 : 0.14) },
                  '& .MuiListItemIcon-root': { color: 'primary.main' },
                  '& .MuiListItemText-primary': { color: 'primary.main', fontWeight: 600 }
                }
              }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
      </Box>

      <Card variant="outlined" sx={{ p: 1.2, borderRadius: 4, bgcolor: 'background.paper' }}>
        <Typography className="industrial-kicker" sx={{ px: 1.2, pt: 0.5 }}>System</Typography>
        <List disablePadding>
          <ListItem disablePadding>
            <ListItemButton onClick={toggleTheme} sx={{ borderRadius: 1, py: 1.1 }}>
              <ListItemIcon>
                {themeMode === 'dark' ? <LightIcon /> : <DarkIcon />}
              </ListItemIcon>
              <ListItemText primary={themeMode === 'dark' ? 'Light Mode' : 'Dark Mode'} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={handleLogout} sx={{ borderRadius: 1, py: 1.1, color: 'error.main' }}>
              <ListItemIcon>
                <LogoutIcon color="error" />
              </ListItemIcon>
              <ListItemText primary="Logout" />
            </ListItemButton>
          </ListItem>
        </List>
      </Card>
    </Box>
  );
};

export default Sidebar;
