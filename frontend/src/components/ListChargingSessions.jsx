import React, { useState, useEffect } from 'react';
import { 
  Box, Typography, Table, TableBody, TableCell, TableContainer, 
  TableHead, TableRow, Paper, Button, IconButton, Dialog, 
  DialogTitle, DialogContent, DialogActions, TextField, MenuItem, 
  Card, Chip, Stack, Tooltip, useMediaQuery, useTheme 
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Edit as EditIcon, Delete as DeleteIcon, Add as AddIcon } from '@mui/icons-material';
import { toast } from 'sonner';
import UploadChargingForm from './UploadChargingForm';
import { getAllowedSessionTypes, getDefaultSessionType } from '../utils/vehicleRules';
import { getFuelBoxSx, getFuelChipSx, getFuelVisual, getSessionCardSx } from '../utils/fuelVisuals';

const SESSION_META = {
  charging: {
    label: 'Charging',
    color: '#00F5FF',
    metricLabel: 'Energy',
    metricUnit: 'kWh',
  },
  fueling: {
    label: 'Fueling',
    color: '#FFB547',
    metricLabel: 'Volume',
    metricUnit: 'L',
  },
};

const ListChargingSessions = () => {
  const [sessions, setSessions] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [open, setOpen] = useState(false);
  const [editSession, setEditSession] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [sessionSubmitting, setSessionSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [busySessionId, setBusySessionId] = useState(null);
  const [pendingDeleteSession, setPendingDeleteSession] = useState(null);
  
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
      if (res.ok) {
        const data = await res.json();
        setSessions(data.map((session) => ({
          ...session,
          vehicle_id: session.vehicle_id ?? session.vehicle_id_ref,
          energy_kwh: session.energy_kwh ?? session.kwh ?? 0,
          fuel_liters: session.fuel_liters ?? 0,
        })));
      }
    } catch { toast.error('Failed to load sessions'); }
  };

  const fetchVehicles = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/vehicles?include_archived=true', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) setVehicles(await res.json());
    } catch {
      toast.error('Failed to load vehicles');
    }
  };

  const handleOpen = (session) => {
    setEditSession({
      ...session,
      vehicle_id: session.vehicle_id ?? session.vehicle_id_ref ?? '',
      kwh: session.kwh ?? session.energy_kwh ?? '',
      cost_huf: session.cost_huf ?? '',
      start_time: session.start_time ?? '',
      end_time: session.end_time ?? '',
      source: session.source ?? 'manual',
      session_type: session.session_type ?? 'charging',
      notes: session.notes ?? '',
      odometer: session.odometer ?? '',
      fuel_liters: session.fuel_liters ?? '',
    });
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditSession(null);
  };

  const handleDeleteRequest = (session) => {
    setPendingDeleteSession(session);
  };

  const handleDeleteDialogClose = () => {
    if (deleteSubmitting) return;
    setPendingDeleteSession(null);
  };

  const handleDelete = async () => {
    if (!pendingDeleteSession) return;
    try {
      setDeleteSubmitting(true);
      setBusySessionId(pendingDeleteSession.id);
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/charging_sessions/${pendingDeleteSession.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast.success('Session deleted');
        setPendingDeleteSession(null);
        fetchSessions();
      } else {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Failed to delete session');
      }
    } catch (error) {
      toast.error(error.message || 'Failed to delete session');
    } finally {
      setDeleteSubmitting(false);
      setBusySessionId(null);
    }
  };

  const handleUpdate = async () => {
    try {
      setSessionSubmitting(true);
      setBusySessionId(editSession.id);
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/charging_sessions/${editSession.id}`, {
        method: 'PATCH',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          vehicle_id: Number(editSession.vehicle_id),
          session_type: editSession.session_type || 'charging',
          start_time: editSession.start_time,
          end_time: editSession.end_time || null,
          kwh: editSession.session_type === 'fueling' ? null : (editSession.kwh === '' ? null : Number(editSession.kwh)),
          fuel_liters: editSession.session_type === 'fueling' ? (editSession.fuel_liters === '' ? null : Number(editSession.fuel_liters)) : null,
          cost_huf: Number(editSession.cost_huf),
          source: editSession.source || 'manual',
          battery_level_start: editSession.battery_level_start ?? null,
          battery_level_end: editSession.battery_level_end ?? null,
          odometer: editSession.odometer === '' ? null : Number(editSession.odometer),
          notes: editSession.notes || null,
        })
      });
      if (res.ok) {
        toast.success('Session updated');
        handleClose();
        fetchSessions();
      } else {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Failed to save session');
      }
    } catch (error) {
      toast.error(error.message || 'Failed to save session');
    } finally {
      setSessionSubmitting(false);
      setBusySessionId(null);
    }
  };

  const getVehicleDisplay = (vId) => {
    const v = vehicles.find(veh => veh.id === vId);
    if (!v) return 'Unknown';
    return v.name || v.license_plate || v.model;
  };

  const getSessionMeta = (sessionType) => SESSION_META[sessionType] || SESSION_META.charging;

  const getVehicleFuelType = (vehicleId) => vehicles.find((vehicle) => vehicle.id === Number(vehicleId))?.fuel_type;
  const activeVehicles = vehicles.filter((vehicle) => !vehicle.is_archived);
  const getSelectableVehicles = (currentVehicleId) => vehicles.filter((vehicle) => !vehicle.is_archived || vehicle.id === Number(currentVehicleId));

  const getSessionChipSx = (fuelType) => getFuelChipSx(theme, fuelType);
  const emptyStateSx = {
    p: { xs: 3, sm: 4 },
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 1,
  };

  const getPrimaryMetric = (session) => {
    const meta = getSessionMeta(session.session_type);
    const value = session.session_type === 'fueling'
      ? Number(session.fuel_liters || 0).toLocaleString()
      : Number(session.energy_kwh || session.kwh || 0).toLocaleString();

    return `${value} ${meta.metricUnit}`;
  };

  return (
    <Box className="section-shell">
      <Typography variant="h4" fontWeight="800" sx={{ mb: 1 }}>
        History
      </Typography>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
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
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {sessions.map((s) => (
            <Card key={s.id} sx={{ ...getSessionCardSx(theme, getVehicleFuelType(s.vehicle_id)), p: 1.75 }}>
              <Box
                sx={{
                  position: 'absolute',
                  inset: '0 auto 0 0',
                  width: 3,
                  background: `linear-gradient(180deg, ${getFuelVisual(getVehicleFuelType(s.vehicle_id)).primary}, ${alpha(getFuelVisual(getVehicleFuelType(s.vehicle_id)).border, 0.5)})`,
                }}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" color="text.primary" sx={{ fontWeight: 700 }}>{getVehicleDisplay(s.vehicle_id)}</Typography>
                <Typography variant="caption">{new Date(s.start_time).toLocaleDateString()}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.25 }}>
                <Chip size="small" label={getSessionMeta(s.session_type).label} variant="outlined" sx={getSessionChipSx(getVehicleFuelType(s.vehicle_id))} />
                <Chip size="small" label={getPrimaryMetric(s)} variant="outlined" />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 1.5 }}>
                <Box>
                  <Typography variant="body2" color="text.secondary">
                    {new Date(s.start_time).toLocaleString()}
                  </Typography>
                  <Typography
                    variant="body1"
                    sx={{
                      color: getFuelVisual(getVehicleFuelType(s.vehicle_id)).primary,
                      fontWeight: 700,
                      textShadow: `0 0 14px ${alpha(getFuelVisual(getVehicleFuelType(s.vehicle_id)).primary, 0.2)}`,
                    }}
                  >
                    {Number(s.cost_huf || 0).toLocaleString()} HUF
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Tooltip title="Edit session">
                    <span>
                      <IconButton size="small" onClick={() => handleOpen(s)} disabled={busySessionId === s.id}><EditIcon fontSize="small" /></IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Delete session">
                    <span>
                      <IconButton size="small" color="error" onClick={() => handleDeleteRequest(s)} disabled={busySessionId === s.id}><DeleteIcon fontSize="small" /></IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Card>
          ))}
          {sessions.length === 0 && (
            <Paper variant="outlined" sx={emptyStateSx}>
              <Chip size="small" label="History" variant="outlined" />
              <Typography variant="h6">
                No history yet
              </Typography>
              <Typography color="text.secondary">
                Add a charging or fueling session to start the history.
              </Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setUploadOpen(true)}>
                New Session
              </Button>
            </Paper>
          )}
        </Box>
      ) : (
        <TableContainer component={Paper} sx={{ borderRadius: 4, overflow: 'hidden', boxShadow: `0 0 10px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.05 : 0.08)}` }}>
          <Table>
            <TableHead>
              <TableRow sx={{ bgcolor: 'background.paper' }}>
                <TableCell>Vehicle</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Metric</TableCell>
                <TableCell>Cost (HUF)</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sessions.map((s) => (
                <TableRow key={s.id}>
                  <TableCell sx={{ fontWeight: 600 }}>{getVehicleDisplay(s.vehicle_id)}</TableCell>
                  <TableCell>
                    <Chip size="small" label={getSessionMeta(s.session_type).label} variant="outlined" sx={getSessionChipSx(getVehicleFuelType(s.vehicle_id))} />
                  </TableCell>
                  <TableCell>{new Date(s.start_time).toLocaleString()}</TableCell>
                  <TableCell>{getPrimaryMetric(s)}</TableCell>
                  <TableCell sx={{ color: getFuelVisual(getVehicleFuelType(s.vehicle_id)).primary, fontWeight: 700 }}>
                    {Number(s.cost_huf || 0).toLocaleString()}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit session">
                      <span>
                        <IconButton onClick={() => handleOpen(s)} size="small" color="primary" disabled={busySessionId === s.id}><EditIcon /></IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete session">
                      <span>
                        <IconButton onClick={() => handleDeleteRequest(s)} size="small" color="error" disabled={busySessionId === s.id}><DeleteIcon /></IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {sessions.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 5 }}>
                    <Stack spacing={1} alignItems="center">
                      <Chip size="small" label="History" variant="outlined" />
                      <Typography variant="h6">
                        No history yet
                      </Typography>
                      <Typography color="text.secondary">
                        Add a charging or fueling session to start the history.
                      </Typography>
                      <Button variant="contained" startIcon={<AddIcon />} onClick={() => setUploadOpen(true)}>
                        New Session
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              )}
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
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                  <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
                    Fuel-aware session details
                  </Typography>
                  <Chip
                    size="small"
                    label={getSessionMeta(editSession.session_type).label}
                    variant="outlined"
                    sx={getSessionChipSx(getVehicleFuelType(editSession.vehicle_id))}
                  />
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <TextField
                    select label="Vehicle" value={editSession.vehicle_id}
                    onChange={(e) => {
                      const nextFuelType = getVehicleFuelType(e.target.value);
                      const nextSessionType = getDefaultSessionType(nextFuelType);
                      setEditSession({
                        ...editSession,
                        vehicle_id: e.target.value,
                        session_type: nextSessionType,
                        kwh: nextSessionType === 'charging' ? editSession.kwh : '',
                        fuel_liters: nextSessionType === 'fueling' ? editSession.fuel_liters : '',
                      });
                    }} fullWidth
                  >
                    {getSelectableVehicles(editSession.vehicle_id).map(v => <MenuItem key={v.id} value={v.id}>{`${getVehicleDisplay(v.id)}${v.is_archived ? ' (Archived)' : ''}`}</MenuItem>)}
                  </TextField>
                  <TextField
                    select
                    label="Session Type"
                    value={editSession.session_type}
                    onChange={(e) => setEditSession({
                      ...editSession,
                      session_type: e.target.value,
                      kwh: e.target.value === 'fueling' ? '' : editSession.kwh,
                      fuel_liters: e.target.value === 'charging' ? '' : editSession.fuel_liters,
                    })}
                    fullWidth
                  >
                    {getAllowedSessionTypes(getVehicleFuelType(editSession.vehicle_id)).map((type) => (
                      <MenuItem key={type} value={type}>{SESSION_META[type].label}</MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={editSession.session_type === 'fueling' ? 'Volume (L)' : 'Energy (kWh)'}
                    type="number"
                    value={editSession.session_type === 'fueling' ? editSession.fuel_liters : editSession.kwh}
                    onChange={(e) => setEditSession({
                      ...editSession,
                      [editSession.session_type === 'fueling' ? 'fuel_liters' : 'kwh']: e.target.value,
                    })}
                    fullWidth
                  />
                  <TextField label="Cost (HUF)" type="number" value={editSession.cost_huf} onChange={(e) => setEditSession({...editSession, cost_huf: e.target.value})} fullWidth />
                  <TextField label="Notes" value={editSession.notes} onChange={(e) => setEditSession({...editSession, notes: e.target.value})} fullWidth />
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={sessionSubmitting}>Cancel</Button>
          <Button onClick={handleUpdate} variant="contained" disabled={sessionSubmitting}>{sessionSubmitting ? 'Saving...' : 'Save'}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!pendingDeleteSession} onClose={handleDeleteDialogClose} fullWidth maxWidth="xs">
        <DialogTitle>Delete session</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            This session will be removed permanently from the history.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteDialogClose} disabled={deleteSubmitting}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleteSubmitting}>
            {deleteSubmitting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={uploadOpen} onClose={() => setUploadOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Session</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <UploadChargingForm
            vehicles={activeVehicles}
            onSuccess={() => {
              setUploadOpen(false);
              fetchSessions();
            }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
};

export default ListChargingSessions;
