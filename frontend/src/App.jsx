import './App.css'
import { useState } from 'react';
import Sidebar from './components/Sidebar';
import UploadChargingForm from './components/UploadChargingForm';
import ListChargingSessions from './components/ListChargingSessions';
import { Box } from '@mui/material';

function App() {
  const [currentPage, setCurrentPage] = useState('upload');

  return (
    <Box display="flex" height="100vh">
      <Sidebar setCurrentPage={setCurrentPage} />
      <Box flexGrow={1} p={3}>
        {currentPage === 'upload' && <UploadChargingForm />}
        {currentPage === 'list' && <ListChargingSessions />}
      </Box>
    </Box>
  );
}

export default App;