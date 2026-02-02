import './App.css'
import { useState, useMemo } from 'react';
import MobileNav from './components/MobileNav';
import UploadChargingForm from './components/UploadChargingForm';
import ListChargingSessions from './components/ListChargingSessions';
import { Box, Container, CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'

function App() {
  const [currentPage, setCurrentPage] = useState('upload');

  const theme = useMemo(() => createTheme({
    palette: {
      mode: 'dark',
      primary: {
        main: '#00e676', // Electric green
      },
      secondary: {
        main: '#2979ff', // Tech blue
      },
      background: {
        default: '#0a0b10',
        paper: '#161b22',
      },
    },
    shape: {
      borderRadius: 16,
    },
    typography: {
      fontFamily: '"Rajdhani", "Roboto", "Helvetica", "Arial", sans-serif',
      h5: {
        fontWeight: 700,
        letterSpacing: '1px',
        textTransform: 'uppercase',
      },
    },
    components: {
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'linear-gradient(135deg, rgba(0,230,118,0.05) 0%, rgba(0,230,118,0) 100%)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(0,230,118,0.2)',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            boxShadow: '0 4px 14px 0 rgba(0, 230, 118, 0.39)',
          },
        },
      },
    },
  }), []);

  return (
    <ThemeProvider theme={theme}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <CssBaseline />
        <Box sx={{ 
          pb: 10, 
          minHeight: '100vh', 
          background: 'radial-gradient(circle at top right, #1a237e 0%, #0a0b10 40%)',
          backgroundAttachment: 'fixed'
        }}>
          <Container maxWidth="sm" sx={{ pt: 4, px: 2 }}>
            {currentPage === 'upload' && <UploadChargingForm onSuccess={() => setCurrentPage('list')} />}
            {currentPage === 'list' && <ListChargingSessions />}
          </Container>
          <MobileNav currentPage={currentPage} setCurrentPage={setCurrentPage} />
        </Box>
      </LocalizationProvider>
    </ThemeProvider>
  );
}

export default App;
