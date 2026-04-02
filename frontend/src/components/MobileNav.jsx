import React from 'react';
import { Paper, BottomNavigation, BottomNavigationAction, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { 
  Dashboard as DashIcon, 
  DirectionsCar as CarIcon, 
  Timeline as ActivityIcon,
  BarChart as AnalyticsIcon,
  Person as PersonIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';

const MobileNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const darkMode = theme.palette.mode === 'dark';

  const getActiveTab = () => {
    switch (location.pathname) {
      case '/': return 0;
      case '/vehicles': return 1;
      case '/activity':
      case '/sessions':
      case '/expenses':
        return 2;
      case '/analytics': return 3;
      case '/account': return 4;
      default: return 0;
    }
  };

  return (
    <Paper 
      sx={{ 
        position: 'fixed', 
        bottom: 0, 
        left: 0, 
        right: 0, 
        display: { xs: 'block', sm: 'none' },
        zIndex: 1000,
        borderRadius: '8px 8px 0 0',
        overflow: 'hidden',
        borderTop: '1px solid',
        borderColor: darkMode ? alpha(theme.palette.primary.main, 0.28) : alpha('#0f1a22', 0.14),
        background: darkMode
          ? 'linear-gradient(180deg, rgba(12,18,24,0.94), rgba(7,10,14,0.98))'
          : 'linear-gradient(180deg, rgba(250,252,253,0.96), rgba(229,236,241,0.98))',
        backdropFilter: 'blur(8px)',
        boxShadow: darkMode
          ? `0 -8px 18px rgba(0,0,0,0.24), 0 0 12px ${alpha(theme.palette.primary.main, 0.08)}`
          : `0 -8px 18px rgba(27,39,49,0.08), 0 0 0 1px ${alpha(theme.palette.common.white, 0.45)} inset`
      }} 
      elevation={3}
    >
      <BottomNavigation
        showLabels
        value={getActiveTab()}
        onChange={(event, newValue) => {
          const paths = ['/', '/vehicles', '/activity', '/analytics', '/account'];
          navigate(paths[newValue]);
        }}
        sx={{ height: 72 }}
      >
        <BottomNavigationAction label="Dash" icon={<DashIcon />} />
        <BottomNavigationAction label="Cars" icon={<CarIcon />} />
        <BottomNavigationAction label="Activity" icon={<ActivityIcon />} />
        <BottomNavigationAction label="Stats" icon={<AnalyticsIcon />} />
        <BottomNavigationAction label="Account" icon={<PersonIcon />} />
      </BottomNavigation>
    </Paper>
  );
};

export default MobileNav;
