import React from 'react';
import { Paper, BottomNavigation, BottomNavigationAction } from '@mui/material';
import { 
  Dashboard as DashIcon, 
  DirectionsCar as CarIcon, 
  EvStation as ChargeIcon,
  BarChart as AnalyticsIcon
} from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';

const MobileNav = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const getActiveTab = () => {
    switch (location.pathname) {
      case '/': return 0;
      case '/vehicles': return 1;
      case '/sessions': return 2;
      case '/analytics': return 3;
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
        borderRadius: '20px 20px 0 0',
        overflow: 'hidden',
        boxShadow: '0 -5px 20px rgba(0,0,0,0.1)'
      }} 
      elevation={3}
    >
      <BottomNavigation
        showLabels
        value={getActiveTab()}
        onChange={(event, newValue) => {
          const paths = ['/', '/vehicles', '/sessions', '/analytics'];
          navigate(paths[newValue]);
        }}
      >
        <BottomNavigationAction label="Dash" icon={<DashIcon />} />
        <BottomNavigationAction label="Cars" icon={<CarIcon />} />
        <BottomNavigationAction label="Logs" icon={<ChargeIcon />} />
        <BottomNavigationAction label="Stats" icon={<AnalyticsIcon />} />
      </BottomNavigation>
    </Paper>
  );
};

export default MobileNav;
