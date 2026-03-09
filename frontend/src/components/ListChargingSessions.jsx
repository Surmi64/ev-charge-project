import React, { useState, useEffect } from 'react';
import { 
  Box, Typography, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, Paper, Button, IconButton, Dialog, 
  DialogTitle, DialogContent, DialogActions, TextField, MenuItem, 
  Card, useMediaQuery, useTheme 
} from '@mui/material';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon } from '@mui/icons-material';
import { toast } from 'sonner';
import UploadChargingForm from './UploadChargingForm';

const ListChargingSessions = () => {
  const [sessions, setSessions] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [open, setOpen] = useState(false);
  const [editSession, setEditSession] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    fetchSessions();
    fetchVehicles();
  }, []);

  const fetchSessions = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/charging_sessions', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setSessions(await res.json());
    } catch (err) { toast.error('Hiba a betöltéskor'); }
  };

  const fetchVehicles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/vehicles', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setVehicles(await res.json());
    } catch (err) { console.error(err); }
  };

  const handleOpen = (session) => {
    setEditSession({ ...session });
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditSession(null);
  };

  const handleDelete = async (id) => {
    if (!confirm('Biztosan törlöd?')) return;
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/charging_sessions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('Törölve');
        fetchSessions();
      }
    } catch (err) { toast.error('Hiba a törléskor'); }
  };

  const handleUpdate = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/charging_sessions/${editSession.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          vehicle_id: editSession.vehicle_id,
          energy_kwh: Number(editSession.energy_kwh),
          cost_huf: Number(editSession.cost_huf),
          duration_minutes: Number(editSession.duration_minutes),
          start_time: editSession.start_time
        })
      });
      if (res.ok) {
        toast.success('Sikeres módosítás');
        handleClose();
        fetchSessions();
      }
    } catch (err) { toast.error('Hiba a mentéskor'); }
  };

  const getVehicleDisplay = (vId) => {
    const v = vehicles.find(veh => veh.id === vId);
    if (!v) return 'Unknown';
    return v.name || v.license_plate || v.model;
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="800">History</Typography>
        <Button 
          variant="contained" 
          startIcon={<AddIcon />}
          onClick={() => setUploadOpen(true)}
          sx={{ borderRadius: 3 }}
        >
          New Session
        </Button>
      </Box>

      {isMobile ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {sessions.map((s) => (
            <Card key={s.id} sx={{ p: 2, borderRadius: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" color="primary">{getVehicleDisplay(s.vehicle_id)}</Typography>
                <Typography variant="caption">{new Date(s.start_time).toLocaleDateString()}</Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="body2">{s.energy_kwh} kWh • {s.cost_huf} HUF</Typography>
                <Box>
                  <IconButton size="small" onClick={() => handleOpen(s)}><EditIcon fontSize="small" /></IconButton>
                  <IconButton size="small" color="error" onClick={() => handleDelete(s.id)}><DeleteIcon fontSize="small" /></IconButton>
                </Box>
              </Box>
            </Card>
          ))}
        </Box>
      ) : (
        <TableContainer component={Paper} sx={{ borderRadius: 4, overflow: 'hidden' }}>
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'background.paper' }}>
                <TableCell>Vehicle</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Energy (kWh)</TableCell>
                <TableCell>Cost (HUF)</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell sx={{ fontWeight: 600 }}>{getVehicleDisplay(s.vehicle_id)}</TableCell>
                  <TableCell>{new Date(s.start_time).toLocaleString()}</TableCell>
                  <TableCell>{s.energy_kwh}</TableCell>
                  <TableCell>{s.cost_huf}</TableCell>
                  <TableCell align="right">
                    <IconButton onClick={() => handleOpen(s)} size="small" color="primary"><EditIcon /></IconButton>
                    <IconButton onClick={() => handleDelete(s.id)} size="small" color="error"><DeleteIcon /></IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Edit Dialog */}
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="xs">
        <DialogTitle>Update Session</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {editSession && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <TextField
                select label="Vehicle" value={editSession.vehicle_id}
                onChange={(e) => setEditSession({...editSession, vehicle_id: e.target.value})} fullWidth
              >
                {vehicles.map(v => <MenuItem key={v.id} value={v.id}>{getVehicleDisplay(v.id)}</MenuItem>)}
              </TextField>
              <TextField label="Energy (kWh)" type="number" value={editSession.energy_kwh} onChange={(e) => setEditSession({...editSession, energy_kwh: e.target.value})} fullWidth />
              <TextField label="Cost (HUF)" type="number" value={editSession.cost_huf} onChange={(e) => setEditSession({...editSession, cost_huf: e.target.value})} fullWidth />
              <TextField label="Duration (min)" type="number" value={editSession.duration_minutes} onChange={(e) => setEditSession({...editSession, duration_minutes: e.target.value})} fullWidth />
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button onClick={handleUpdate} variant="contained">Save</Button>
        </DialogActions>
      </Dialog>

      <UploadChargingForm open={uploadOpen} handleClose={() => setUploadOpen(false)} onSuccess={fetchSessions} />
    </Box>
  );
};

export default ListChargingSessions;
