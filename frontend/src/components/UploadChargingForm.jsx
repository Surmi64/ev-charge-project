import React, { useState, useEffect } from 'react';
import {
  Box, TextField, MenuItem, Button, Grid, InputAdornment
} from '@mui/material';

const vehicles = [
  { id: 1, label: 'SSA511' }
];

const currencies = ['HUF', 'EUR', 'USD'];
const API_URL = import.meta.env.VITE_API_URL || 'http://100.104.111.43:5555';

const UploadChargingForm = () => {
  const [vehicleId, setVehicleId] = useState(1);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [kwh, setKwh] = useState('');
  const [duration, setDuration] = useState('');
  const [cost, setCost] = useState('');
  const [pricePerKwh, setPricePerKwh] = useState('');
  const [currency, setCurrency] = useState('HUF');
  const [notes, setNotes] = useState('');
  const [odometer, setOdometer] = useState('');

  useEffect(() => {
    if (startTime && endTime) {
      const durationSeconds = (new Date(endTime) - new Date(startTime)) / 1000;
      setDuration(durationSeconds >= 0 ? durationSeconds : '');
    }
    if (kwh && cost) {
      const price = parseFloat(cost) / parseFloat(kwh);
      setPricePerKwh(!isNaN(price) ? price.toFixed(2) : '');
    }
  }, [startTime, endTime, kwh, cost]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      vehicle_id: vehicleId,
      start_time_posix: Math.floor(new Date(startTime).getTime() / 1000),
      end_time_posix: endTime ? Math.floor(new Date(endTime).getTime() / 1000) : null,
      kwh: kwh ? parseFloat(kwh) : null,
      duration_seconds: duration ? parseFloat(duration) : null,
      cost_huf: cost ? parseFloat(cost) : null,
      price_per_kwh: pricePerKwh ? parseFloat(pricePerKwh) : null,
      source: 'frontend',
      currency,
      invoice_id: null,
      notes,
      provider: notes.split(' ')[0],
      ac_or_dc: notes.toLocaleLowerCase().split(' ').includes('dc') ? 'DC' : 'AC',
      kw: notes.split(' ')[notes.split(' ').length-1],
      license_plate: vehicles.find(v => v.id === vehicleId)?.label || null,
      odometer: odometer
    };

    try {
      const response = await fetch(`${API_URL}/charging_sessions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert('Error: ' + (errorData.error || 'Unknown error'));
      } else {
        alert('Charging session saved successfully!');
        setStartTime('');
        setEndTime('');
        setKwh('');
        setDuration('');
        setCost('');
        setPricePerKwh('');
        setNotes('');
        setOdometer('');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to save charging session. See console for details.');
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        maxWidth: 700,
        margin: '0 auto',
        p: { xs: 2, sm: 4 },
        backgroundColor: '#fff',
        borderRadius: 2,
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      }}
    >
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <TextField
            select
            label="Vehicle"
            fullWidth
            value={vehicleId}
            onChange={(e) => setVehicleId(parseInt(e.target.value))}
          >
            {vehicles.map(v => (
              <MenuItem key={v.id} value={v.id}>{v.label}</MenuItem>
            ))}
          </TextField>
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            type="datetime-local"
            label="Start Time"
            fullWidth
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            type="datetime-local"
            label="End Time"
            fullWidth
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            label="kWh"
            fullWidth
            value={kwh}
            onChange={(e) => setKwh(e.target.value)}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            label="Duration (s)"
            fullWidth
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            label="Cost"
            fullWidth
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start">{currency}</InputAdornment>,
            }}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            label="Price per kWh"
            fullWidth
            value={pricePerKwh}
            onChange={(e) => setPricePerKwh(e.target.value)}
            InputProps={{
              startAdornment: <InputAdornment position="start">{currency}</InputAdornment>,
            }}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            select
            label="Currency"
            fullWidth
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map(c => <MenuItem key={c} value={c}>{c}</MenuItem>)}
          </TextField>
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            label="Odometer (km)"
            name="odometer"
            type="number"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            fullWidth
          />
        </Grid>
        
        <Grid item xs={12} md={12}>
          <TextField
            label="Notes"
            fullWidth
            multiline
            minRows={2}
            value={notes}
            placeholder="Keep this format: TEA Nyíregyháza Ledtechnika DC 60"
            onChange={(e) => setNotes(e.target.value)}
          />
        </Grid>

        <Grid item xs={12}>
          <Button type="submit" variant="contained" color="primary" fullWidth>
            Save
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
};

export default UploadChargingForm;
