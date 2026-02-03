import React from 'react';
import { Paper, BottomNavigation, BottomNavigationAction } from '@mui/material';
import { AddCircle, History, Assessment } from '@mui/icons-material';

const PRIMARY_GRAFANA = 'http://100.104.111.43:3000';
const FALLBACK_GRAFANA = 'http://192.168.0.111:3000';

const MobileNav = ({ currentPage, setCurrentPage }) => {
  const handleAnalyticsClick = async (e) => {
    e.preventDefault();
    let url = PRIMARY_GRAFANA;
    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 1500);
      // We check the backend health as a proxy for network connectivity
      await fetch('http://100.104.111.43:5555/health', { method: 'HEAD', signal: controller.signal });
      clearTimeout(tid);
    } catch (e) {
      url = FALLBACK_GRAFANA;
    }
    window.open(url, '_blank');
  };

  return (
    <Paper sx={{ 
      position: 'fixed', 
      bottom: 16, 
      left: 16, 
      right: 16, 
      zIndex: 1000,
      borderRadius: '24px',
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.1)',
      background: 'rgba(22, 27, 34, 0.8)',
      backdropFilter: 'blur(20px)',
    }} elevation={10}>
      <BottomNavigation
        showLabels
        value={currentPage}
        onChange={(event, newValue) => {
          setCurrentPage(newValue);
        }}
        sx={{
          background: 'transparent',
          height: 64,
          '& .MuiBottomNavigationAction-root': {
            color: 'rgba(255, 255, 255, 0.5)',
            transition: 'all 0.3s ease',
          },
          '& .Mui-selected': {
            color: '#00e676 !important',
            '& .MuiBottomNavigationAction-label': {
              fontWeight: 700,
              fontSize: '0.85rem',
            },
            '& svg': {
              transform: 'scale(1.2)',
            }
          },
        }}
      >
        <BottomNavigationAction value="upload" label="Record" icon={<AddCircle />} />
        <BottomNavigationAction value="list" label="Logs" icon={<History />} />
        <BottomNavigationAction 
          value="stats" 
          label="Analytics" 
          icon={<Assessment />} 
          onClick={handleAnalyticsClick}
        />
      </BottomNavigation>
    </Paper>
  );
};

export default MobileNav;
