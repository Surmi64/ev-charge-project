import React, { useState, useEffect } from "react";
import {
  Box, TextField, MenuItem, Button, Grid, Chip, Typography, useTheme,
  InputAdornment
} from "@mui/material";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { Save, LocalAtm } from "@mui/icons-material";
import dayjs from "dayjs";
import { toast } from 'sonner';
import { getAllowedSessionTypes, getDefaultSessionType, supportsCharging } from '../utils/vehicleRules';
import { getFuelBoxSx, getFuelChipSx } from '../utils/fuelVisuals';

const currencies = ["HUF", "EUR", "USD"];
const SESSION_META = {
  charging: {
    label: 'Charging',
    color: '#00F5FF',
    metricLabel: 'Total energy',
    metricUnit: 'kWh',
    helper: 'Track the delivered electric energy for the session.',
  },
  fueling: {
    label: 'Fueling',
    color: '#FFB547',
    metricLabel: 'Fuel volume',
    metricUnit: 'L',
    helper: 'Track the dispensed fuel volume for the stop.',
  },
};

const UploadChargingForm = ({ onSuccess, vehicles = [] }) => {
  const theme = useTheme();
  const activeVehicles = vehicles.filter((vehicle) => !vehicle.is_archived);
  const [vehicleId, setVehicleId] = useState("");
  const [sessionType, setSessionType] = useState('charging');
  const [startTime, setStartTime] = useState(dayjs());
  const [endTime, setEndTime] = useState(dayjs().add(30, 'minute'));
  const [kwh, setKwh] = useState("");
  const [fuelLiters, setFuelLiters] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState("HUF");
  const [location, setLocation] = useState("");
  const [acOrDc, setAcOrDc] = useState("AC");
  const [kw, setKw] = useState("");
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!vehicleId && activeVehicles.length > 0) {
      const defaultVehicle = activeVehicles.find((vehicle) => vehicle.is_default) || activeVehicles[0];
      setVehicleId(String(defaultVehicle.id));
    }
  }, [activeVehicles, vehicleId]);

  const selectedVehicle = activeVehicles.find((vehicle) => String(vehicle.id) === String(vehicleId));
  const allowedSessionTypes = getAllowedSessionTypes(selectedVehicle?.fuel_type);

  useEffect(() => {
    if (!selectedVehicle) return;

    const defaultType = getDefaultSessionType(selectedVehicle.fuel_type);
    if (!allowedSessionTypes.includes(sessionType)) {
      setSessionType(defaultType);
    }
    if (defaultType === 'fueling') {
      setKwh('');
    }
    if (defaultType === 'charging') {
      setFuelLiters('');
    }
  }, [selectedVehicle?.fuel_type, sessionType]);

  const sessionMeta = SESSION_META[sessionType] || SESSION_META.charging;
  const sessionFuelType = selectedVehicle?.fuel_type || (sessionType === 'charging' ? 'electric' : 'petrol');

  // Auto-calculate values
  const primaryValue = sessionType === 'fueling' ? fuelLiters : kwh;
  const pricePerUnit = (primaryValue && cost) ? (parseFloat(cost) / parseFloat(primaryValue)).toFixed(2) : "0";

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!vehicleId) {
      toast.error('Select a vehicle first');
      return;
    }

    setLoading(true);
    const payload = {
      vehicle_id: Number(vehicleId),
      session_type: sessionType,
      start_time: startTime.toISOString(),
      end_time: endTime ? endTime.toISOString() : null,
      kwh: sessionType === 'charging' && kwh ? parseFloat(kwh) : null,
      fuel_liters: sessionType === 'fueling' && fuelLiters ? parseFloat(fuelLiters) : null,
      cost_huf: cost ? parseFloat(cost) : null,
      source: "web_app",
      odometer: odometer ? parseFloat(odometer) : null,
      notes: notes || [location, sessionType === 'charging' ? acOrDc : null, sessionType === 'charging' && kw ? `${kw}kW` : null].filter(Boolean).join(' • '),
    };

    try {
      const response = await fetch('/api/charging_sessions', {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        toast.error(errorData.detail || errorData.error || 'Failed to save session');
      } else {
        toast.success('Session saved');
        if (onSuccess) onSuccess();
      }
    } catch (err) {
      console.error("Submit error:", err);
      toast.error('Failed to save session');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} sx={{ pb: 1 }}>
      <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                fullWidth
                label="Vehicle"
                size="small"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              >
                {activeVehicles.map((vehicle) => (
                  <MenuItem key={vehicle.id} value={String(vehicle.id)}>
                    {vehicle.name || `${vehicle.make} ${vehicle.model}`}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                select
                fullWidth
                label="Session Type"
                size="small"
                value={sessionType}
                onChange={(e) => setSessionType(e.target.value)}
              >
                {allowedSessionTypes.map((type) => (
                  <MenuItem key={type} value={type}>{SESSION_META[type].label}</MenuItem>
                ))}
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateTimePicker
                label="Start time"
                ampm={false}
                value={startTime}
                onChange={(newValue) => setStartTime(newValue)}
                slotProps={{ textField: { fullWidth: true, size: "small" } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <DateTimePicker
                label="End time"
                ampm={false}
                value={endTime}
                onChange={(newValue) => setEndTime(newValue)}
                slotProps={{ textField: { fullWidth: true, size: "small" } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Location"
                size="small"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </Grid>
            <Grid size={12}>
              <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
                  <Box>
                    <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 0.25 }}>
                      Powertrain Data
                    </Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Fuel-data panels keep an amber neon frame, with hybrid blue and EV green leading the glow.
                    </Typography>
                  </Box>
                  <Chip label={sessionMeta.label} size="small" variant="outlined" sx={getFuelChipSx(theme, sessionFuelType)} />
                </Box>
                <Grid container spacing={1.5}>
                  {sessionType === 'charging' && supportsCharging(selectedVehicle?.fuel_type) && (
                    <Grid size={{ xs: 12, sm: 3 }}>
                      <TextField
                        select
                        fullWidth
                        label="Plug"
                        value={acOrDc}
                        size="small"
                        onChange={(e) => setAcOrDc(e.target.value)}
                      >
                        <MenuItem value="AC">AC</MenuItem>
                        <MenuItem value="DC">DC</MenuItem>
                      </TextField>
                    </Grid>
                  )}

                  {sessionType === 'charging' && supportsCharging(selectedVehicle?.fuel_type) && (
                    <Grid size={{ xs: 12, sm: 3 }}>
                      <TextField
                        fullWidth
                        label="Power"
                        type="number"
                        value={kw}
                        size="small"
                        onChange={(e) => setKw(e.target.value)}
                        InputProps={{
                          endAdornment: <InputAdornment position="end">kW</InputAdornment>,
                        }}
                      />
                    </Grid>
                  )}

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label={sessionMeta.metricLabel}
                      type="number"
                      size="small"
                      value={primaryValue}
                      onChange={(e) => {
                        if (sessionType === 'fueling') {
                          setFuelLiters(e.target.value);
                        } else {
                          setKwh(e.target.value);
                        }
                      }}
                      helperText={sessionMeta.helper}
                      InputProps={{
                        endAdornment: <InputAdornment position="end">{sessionMeta.metricUnit}</InputAdornment>,
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      fullWidth
                      label="Cost"
                      type="number"
                      size="small"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      InputProps={{
                        startAdornment: <InputAdornment position="start"><LocalAtm sx={{ fontSize: 20 }} /></InputAdornment>,
                      }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 2 }}>
                    <TextField
                      select
                      fullWidth
                      label="CCY"
                      size="small"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                    >
                      {currencies.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
                    </TextField>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Unit price"
                      size="small"
                      value={`${pricePerUnit} ${currency}/${sessionMeta.metricUnit}`}
                      InputProps={{ readOnly: true }}
                    />
                  </Grid>
                </Grid>
              </Box>
            </Grid>

            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Odometer"
                type="number"
                size="small"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
                InputProps={{
                  endAdornment: <InputAdornment position="end">km</InputAdornment>,
                }}
              />
            </Grid>
            <Grid size={12}>
              <TextField
                fullWidth
                label="Notes"
                size="small"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                multiline
                minRows={2}
              />
            </Grid>
      </Grid>

      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={loading || !vehicleId || !primaryValue || !cost}
          startIcon={<Save />}
          sx={{ 
            width: '100%', 
            maxWidth: '300px',
            borderRadius: 3, 
            py: 1.5, 
            fontWeight: 'bold' 
          }}
        >
          {loading ? "Saving..." : `Save ${sessionMeta.label}`}
        </Button>
      </Box>
    </Box>
  );
};

export default UploadChargingForm;
