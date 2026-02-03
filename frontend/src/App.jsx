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
        main: '#00ffa3', // Cyber Neon Green
      },
      secondary: {
        main: '#1288ff', // Electric Pulse Blue
      },
      background: {
        default: '#050508', // Deep Space Black
        paper: 'rgba(20, 25, 35, 0.7)', // Translucent Dark
      },
      text: {
        primary: '#e0e0e0',
        secondary: '#a0a0a0',
      },
    },
    shape: {
      borderRadius: 20,
    },
    typography: {
      fontFamily: '"Orbitron", "Rajdhani", sans-serif',
      h5: {
        fontWeight: 800,
        letterSpacing: '2px',
        textTransform: 'uppercase',
        background: 'linear-gradient(90deg, #00ffa3 0%, #1288ff 100%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        textShadow: '0 0 20px rgba(0, 255, 163, 0.3)',
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarColor: "#00ffa3 #050508",
            "&::-webkit-scrollbar": {
              width: "8px",
            },
            "&::-webkit-scrollbar-track": {
              background: "#050508",
            },
            "&::-webkit-scrollbar-thumb": {
              background: "#00ffa3",
              borderRadius: "10px",
            },
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 100%)',
            backdropFilter: 'blur(16px) saturate(180%)',
            WebkitBackdropFilter: 'blur(16px) saturate(180%)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.8)',
            overflow: 'visible',
            transition: 'transform 0.2s ease-in-out',
            '&:hover': {
              transform: 'translateY(-4px)',
              border: '1px solid rgba(0, 255, 163, 0.3)',
            },
          },
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'uppercase',
            fontWeight: 700,
            letterSpacing: '1px',
            background: 'linear-gradient(90deg, #00ffa3 0%, #1288ff 100%)',
            color: '#050508',
            boxShadow: '0 0 15px rgba(0, 255, 163, 0.4)',
            '&:hover': {
              boxShadow: '0 0 25px rgba(0, 255, 163, 0.6)',
              background: 'linear-gradient(90deg, #00ffa3 20%, #1288ff 120%)',
            },
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              backgroundColor: 'rgba(255,255,255,0.03)',
              '& fieldset': {
                borderColor: 'rgba(255,255,255,0.1)',
              },
              '&:hover fieldset': {
                borderColor: 'rgba(0, 255, 163, 0.5)',
              },
            },
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
          pb: 12, // Biztonságos távolság a navigációtól
          minHeight: '100vh', 
          background: 'radial-gradient(circle at 0% 0%, #050508 0%, #0a0a1f 50%, #050508 100%)',
          position: 'relative',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: '-20%',
            left: '-10%',
            width: '40%',
            height: '40%',
            background: 'radial-gradient(circle, rgba(0, 255, 163, 0.05) 0%, transparent 70%)',
            zIndex: 0,
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            bottom: '-10%',
            right: '-10%',
            width: '50%',
            height: '50%',
            background: 'radial-gradient(circle, rgba(18, 136, 255, 0.05) 0%, transparent 70%)',
            zIndex: 0,
          }
        }}>
          <Container maxWidth="sm" sx={{ pt: 1, px: 2, position: 'relative', zIndex: 1 }}>
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
