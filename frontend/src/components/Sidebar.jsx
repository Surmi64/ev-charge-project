import React from 'react';
import { 
  Box, 
  List, 
  ListItem, 
  ListItemButton, 
  ListItemIcon, 
  ListItemText, 
  Typography,
  Card
} from '@mui/material';
import { 
  Dashboard as DashIcon, 
  DirectionsCar as CarIcon, 
  EvStation as ChargeIcon, 
  BarChart as AnalyticsIcon,
  Logout as LogoutIcon,
  Brightness4 as DarkIcon,
  Brightness7 as LightIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';

const Sidebar = ({ toggleTheme, themeMode }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { text: 'Dashboard', icon: <DashIcon />, path: '/' },
    { text: 'Vehicles', icon: <CarIcon />, path: '/vehicles' },
    { text: 'Sessions', icon: <ChargeIcon />, path: '/sessions' },
    { text: 'Analytics', icon: <AnalyticsIcon />, path: '/analytics' },
  ];

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  return (
    <Box sx={{ 
      width: 280, 
      flexShrink: 0,
      display: { xs: 'none', sm: 'flex' },
      flexDirection: 'column',
      borderRight: '1px solid',
      borderColor: 'divider',
      bgcolor: 'background.paper',
      p: 2
    }}>
      <Box sx={{ p: 2, mb: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ 
          width: 40, 
          height: 40, 
          bgcolor: 'primary.main', 
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 0 20px rgba(0, 245, 255, 0.3)'
        }}>
          <ChargeIcon sx={{ color: '#fff' }} />
        </Box>
        <Typography variant="h6" fontWeight="800" sx={{ letterSpacing: -0.5 }}>
          FuelUp
        </Typography>
      </Box>

      <List sx={{ flexGrow: 1 }}>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding sx={{ mb: 1 }}>
            <ListItemButton 
              onClick={() => navigate(item.path)}
              selected={location.pathname === item.path}
              sx={{
                borderRadius: 2,
                '&.Mui-selected': {
                  bgcolor: 'rgba(0, 245, 255, 0.08)',
                  '&:hover': { bgcolor: 'rgba(0, 245, 255, 0.12)' },
                  '& .MuiListItemIcon-root': { color: 'primary.main' },
                  '& .MuiListItemText-primary': { color: 'primary.main', fontWeight: 600 }
                }
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>

      <Card variant="outlined" sx={{ p: 1, borderRadius: 3, bgcolor: 'background.default' }}>
        <List disablePadding>
          <ListItem disablePadding>
            <ListItemButton onClick={toggleTheme} sx={{ borderRadius: 2 }}>
              <ListItemIcon>
                {themeMode === 'dark' ? <LightIcon /> : <DarkIcon />}
              </ListItemIcon>
              <ListItemText primary={themeMode === 'dark' ? 'Light Mode' : 'Dark Mode'} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={handleLogout} sx={{ borderRadius: 2, color: 'error.main' }}>
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
