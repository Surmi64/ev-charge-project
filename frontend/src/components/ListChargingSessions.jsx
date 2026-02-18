import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, 
  CircularProgress, IconButton, Chip, Divider, Stack,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  TextField, MenuItem, InputAdornment, Autocomplete
} from '@mui/material';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { Edit, EvStation, AccessTime, LocalAtm, DirectionsCar, Save, Close } from '@mui/icons-material';
import dayjs from 'dayjs';

const API_URL = import.meta.env.VITE_API_URL || 'http://100.104.111.43:5555';
const currencies = ["HUF", "EUR", "USD"];

const EditSessionDialog = ({ session, open, onClose, onSave, locationMapping }) => {
  const [formData, setFormData] = useState({ ...session });

  useEffect(() => {
    if (session) {
      setFormData({
        ...session,
        start_time: dayjs(session.start_time),
        end_time: session.end_time ? dayjs(session.end_time) : null,
      });
    }
  }, [session]);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const availableCities = formData.provider && locationMapping[formData.provider] 
    ? Object.keys(locationMapping[formData.provider]) 
    : [];
    
  const availableDetails = formData.provider && formData.city && locationMapping[formData.provider]?.[formData.city]
    ? locationMapping[formData.provider][formData.city]
    : [];

  const handleSave = () => {
    const durationMinutes = (formData.start_time && formData.end_time) 
      ? formData.end_time.diff(formData.start_time, 'minute') 
      : 0;
    const pricePerKwh = (formData.kwh && formData.cost_huf) 
      ? (parseFloat(formData.cost_huf) / parseFloat(formData.kwh)).toFixed(2) 
      : "0";

    const payload = {
      ...formData,
      start_time: formData.start_time.toISOString(),
      end_time: formData.end_time ? formData.end_time.toISOString() : null,
      duration_seconds: durationMinutes * 60,
      price_per_kwh: parseFloat(pricePerKwh),
      cost_huf: formData.cost_huf ? parseFloat(formData.cost_huf) : null,
      kwh: formData.kwh ? parseFloat(formData.kwh) : null,
      odometer: formData.odometer ? parseFloat(formData.odometer) : null,
    };
    onSave(payload);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        Edit Session
        <IconButton onClick={onClose} size="small"><Close /></IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2} sx={{ mt: 0.5 }}>
          <Grid size={{ xs: 6 }}>
            <DateTimePicker
              label="Start"
              ampm={false}
              value={formData.start_time}
              onChange={(val) => handleChange('start_time', val)}
              slotProps={{ textField: { fullWidth: true, size: "small" } }}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <DateTimePicker
              label="Stop"
              ampm={false}
              value={formData.end_time}
              onChange={(val) => handleChange('end_time', val)}
              slotProps={{ textField: { fullWidth: true, size: "small" } }}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Autocomplete
              freeSolo
              options={Object.keys(locationMapping)}
              value={formData.provider || ''}
              onInputChange={(e, val) => {
                setFormData(prev => ({ ...prev, provider: val, city: "", location_detail: "" }));
              }}
              renderInput={(params) => <TextField {...params} label="Provider" fullWidth size="small" />}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Autocomplete
              freeSolo
              options={availableCities}
              value={formData.city || ''}
              onInputChange={(e, val) => {
                setFormData(prev => ({ ...prev, city: val, location_detail: "" }));
              }}
              renderInput={(params) => <TextField {...params} label="City" fullWidth size="small" />}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Autocomplete
              freeSolo
              options={availableDetails}
              value={formData.location_detail || ''}
              onInputChange={(e, val) => handleChange('location_detail', val)}
              renderInput={(params) => <TextField {...params} label="Charger" fullWidth size="small" />}
            />
          </Grid>

          <Grid size={{ xs: 6 }}>
            <TextField
              select
              fullWidth
              label="Plug"
              value={formData.ac_or_dc || 'AC'}
              size="small"
              onChange={(e) => handleChange('ac_or_dc', e.target.value)}
            >
              <MenuItem value="AC">AC</MenuItem>
              <MenuItem value="DC">DC</MenuItem>
            </TextField>
          </Grid>
          <Grid size={{ xs: 6 }}>
            <TextField
              fullWidth
              label="Power"
              type="number"
              value={formData.kw || ''}
              size="small"
              onChange={(e) => handleChange('kw', e.target.value)}
              InputProps={{ endAdornment: <InputAdornment position="end">kW</InputAdornment> }}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              label="Total Energy"
              type="number"
              size="small"
              value={formData.kwh || ''}
              onChange={(e) => handleChange('kwh', e.target.value)}
              InputProps={{ endAdornment: <InputAdornment position="end">kWh</InputAdornment> }}
            />
          </Grid>
          <Grid size={{ xs: 8 }}>
            <TextField
              fullWidth
              label="Cost"
              type="number"
              size="small"
              value={formData.cost_huf || ''}
              onChange={(e) => handleChange('cost_huf', e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><LocalAtm sx={{ fontSize: 20 }} /></InputAdornment> }}
            />
          </Grid>
          <Grid size={{ xs: 4 }}>
            <TextField
              select
              fullWidth
              label="CCY"
              size="small"
              value={formData.currency || 'HUF'}
              onChange={(e) => handleChange('currency', e.target.value)}
            >
              {currencies.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              label="Odometer"
              type="number"
              size="small"
              value={formData.odometer || ''}
              onChange={(e) => handleChange('odometer', e.target.value)}
              InputProps={{ endAdornment: <InputAdornment position="end">km</InputAdornment> }}
            />
          </Grid>
          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              label="Notes"
              size="small"
              multiline
              rows={2}
              value={formData.notes || ''}
              onChange={(e) => handleChange('notes', e.target.value)}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" startIcon={<Save />}>Save Changes</Button>
      </DialogActions>
    </Dialog>
  );
};

const SessionCard = ({ session, onEdit }) => {
  const startTime = session.start_time ? dayjs(session.start_time) : null;
  const endTime = session.end_time ? dayjs(session.end_time) : null;
  const isDC = session.ac_or_dc?.toUpperCase() === 'DC';

  return (
    <Card sx={{ mb: 2, borderRadius: 2, boxShadow: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              {startTime ? startTime.format('YYYY.MM.DD HH:mm') : '?'} 
              {endTime ? ` → ${endTime.format('HH:mm')}` : ''}
            </Typography>
            <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', color: '#00e676' }}>
              {session.kwh || 0} <small style={{ fontSize: '0.6em', opacity: 0.8 }}>kWh</small>
            </Typography>
          </Box>
          <Stack alignItems="flex-end">
            <Stack direction="row" spacing={1} mb={1}>
              <Typography variant="caption" sx={{ alignSelf: 'center', opacity: 0.7 }}>
                {session.kw ? `${session.kw}kW` : ''}
              </Typography>
              <Chip 
                label={session.ac_or_dc || 'AC'} 
                color={isDC ? "error" : "success"} 
                size="small" 
                variant="filled"
                sx={{ fontWeight: 'bold', height: 20, fontSize: '0.65rem' }}
              />
            </Stack>
            <Typography variant="h6" color="secondary.main" sx={{ fontWeight: 'bold' }}>
              {Math.round(session.cost_huf || 0).toLocaleString()} <small style={{ fontSize: '0.6em' }}>{session.currency || 'HUF'}</small>
            </Typography>
          </Stack>
        </Stack>

        <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.05)' }} />

        <Grid container spacing={1} mt={0.5}>
          <Grid size={{ xs: 12 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {session.provider || 'Unknown'} • {session.city || ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {[session.location_detail, session.notes].filter(Boolean).join(' • ')}
            </Typography>
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <IconButton size="small" onClick={() => onEdit(session)}>
            <Edit fontSize="small" />
          </IconButton>
        </Box>
      </CardContent>
    </Card>
  );
};

const ListChargingSessions = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingSession, setEditingSession] = useState(null);
  const [locationMapping, setLocationMapping] = useState({});

  useEffect(() => {
    fetchSessions();
    fetchLocations();
  }, []);

  const fetchSessions = () => {
    setLoading(true);
    fetch(`${API_URL}/charging_sessions`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setSessions(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  };

  const fetchLocations = () => {
    fetch(`${API_URL}/charging_sessions/locations`)
      .then(res => res.json())
      .then(data => setLocationMapping(data))
      .catch(err => console.error("Error fetching locations:", err));
  };

  const handleUpdate = (payload) => {
    fetch(`${API_URL}/charging_sessions/${payload.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(res => {
        if (res.ok) {
          setEditingSession(null);
          fetchSessions();
        } else {
          alert("Failed to update session");
        }
      })
      .catch(err => {
        console.error("Update error:", err);
        alert("Connection error");
      });
  };

  if (loading) return (
    <Box display="flex" justifyContent="center" p={5}>
      <CircularProgress />
    </Box>
  );

  return (
    <Box sx={{ pb: 8 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 'bold', px: 1, textAlign: 'center' }}>
        History
      </Typography>
      {!Array.isArray(sessions) || sessions.length === 0 ? (
        <Typography variant="body1" sx={{ textAlign: 'center', mt: 4, color: 'text.secondary' }}>
          No charging sessions yet.
        </Typography>
      ) : (
        sessions.map((s) => (
          <SessionCard key={s.id} session={s} onEdit={setEditingSession} />
        ))
      )}

      {editingSession && (
        <EditSessionDialog 
          session={editingSession} 
          open={!!editingSession} 
          onClose={() => setEditingSession(null)} 
          onSave={handleUpdate}
          locationMapping={locationMapping}
        />
      )}
    </Box>
  );
};

export default ListChargingSessions;
