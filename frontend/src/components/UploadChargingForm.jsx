import React, { useState, useEffect } from "react";
import {
  Box, TextField, MenuItem, Button, Grid,
  InputAdornment, Typography, Card, CardContent,
  Stack, Autocomplete
} from "@mui/material";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { Save, EvStation, LocalAtm, DirectionsCar } from "@mui/icons-material";
import dayjs from "dayjs";

const currencies = ["HUF", "EUR", "USD"];

const API_URL = import.meta.env.VITE_API_URL || "http://100.104.111.43:5555";

const UploadChargingForm = ({ onSuccess }) => {
  const [startTime, setStartTime] = useState(dayjs());
  const [endTime, setEndTime] = useState(dayjs().add(30, 'minute'));
  const [kwh, setKwh] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState("HUF");
  const [provider, setProvider] = useState("");
  const [city, setCity] = useState("");
  const [locationDetail, setLocationDetail] = useState("");
  const [acOrDc, setAcOrDc] = useState("AC");
  const [kw, setKw] = useState("");
  const [odometer, setOdometer] = useState("");
  const [loading, setLoading] = useState(false);
  const [locationMapping, setLocationMapping] = useState({});

  useEffect(() => {
    fetch(`${API_URL}/charging_sessions/locations`)
      .then(res => res.json())
      .then(data => {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          setLocationMapping(data);
        } else {
          console.error("Expected locations object but got:", data);
        }
      })
      .catch(err => console.error("Error fetching locations:", err));
  }, []);

  const availableCities = provider && locationMapping[provider] 
    ? Object.keys(locationMapping[provider]) 
    : [];
    
  const availableDetails = provider && city && locationMapping[provider]?.[city]
    ? locationMapping[provider][city]
    : [];

  // Auto-calculate values
  const pricePerKwh = (kwh && cost) ? (parseFloat(cost) / parseFloat(kwh)).toFixed(2) : "0";
  const durationMinutes = (startTime && endTime) ? endTime.diff(startTime, 'minute') : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const payload = {
      vehicle_id: 1, // Fixed ID for SSA511
      start_time: startTime.toISOString(),
      end_time: endTime ? endTime.toISOString() : null,
      kwh: kwh ? parseFloat(kwh) : null,
      duration_seconds: durationMinutes * 60,
      cost_huf: cost ? parseFloat(cost) : null,
      price_per_kwh: parseFloat(pricePerKwh),
      source: "frontend_v4",
      currency,
      provider,
      city,
      location_detail: locationDetail,
      ac_or_dc: acOrDc,
      kw: kw,
      license_plate: "SSA511",
      odometer: odometer ? parseFloat(odometer) : null,
    };

    try {
      const response = await fetch(`${API_URL}/charging_sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert("Error: " + (errorData.error || "Unknown error"));
      } else {
        if (onSuccess) onSuccess();
      }
    } catch (err) {
      console.error("Submit error:", err);
      alert("Failed to save session");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box 
      component="form" 
      onSubmit={handleSubmit} 
      sx={{ 
        display: 'flex', 
        flexDirection: 'column', 
        minHeight: { xs: 'calc(100vh - 120px)', sm: 'auto' }, 
        justifyContent: 'space-between',
        pb: 2
      }}
    >
      <Typography variant="h5" sx={{ mb: { xs: 1, sm: 3 }, fontWeight: 'bold', px: 1, color: 'primary.main', textAlign: 'center' }}>
        ⚡ EV CHARGE ENTRY ⚡
      </Typography>

      <Card sx={{ 
        flexGrow: { xs: 1, sm: 0 }, 
        display: 'flex', 
        flexDirection: 'column', 
        justifyContent: 'center',
        borderRadius: 2, 
        boxShadow: 2, 
        mb: { xs: 2, sm: 4 },
        transition: 'all 0.3s ease'
      }}>
        <CardContent sx={{ 
          p: { xs: 2, sm: 3 }, 
          '&:last-child': { pb: { xs: 2, sm: 3 } },
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center'
        }}>
          <Grid container spacing={{ xs: 2, sm: 3 }} sx={{ width: '100%', m: 0 }}>
            <Grid item xs={12} sx={{ width: '100%', p: '0 !important', mb: { xs: 2, sm: 3 } }}>
              <DateTimePicker
                label="Start"
                value={startTime}
                onChange={(newValue) => setStartTime(newValue)}
                slotProps={{ textField: { fullWidth: true, size: "small" } }}
              />
            </Grid>
            <Grid item xs={12} sx={{ width: '100%', p: '0 !important', mb: { xs: 2, sm: 3 } }}>
              <DateTimePicker
                label="Stop"
                value={endTime}
                onChange={(newValue) => setEndTime(newValue)}
                slotProps={{ textField: { fullWidth: true, size: "small" } }}
              />
            </Grid>

            {/* Full-width vertical layout for Provider, City, Charger */}
            <Grid item xs={12} sx={{ width: '100%', p: '0 !important', mb: { xs: 2, sm: 3 } }}>
              <Autocomplete
                freeSolo
                options={Object.keys(locationMapping)}
                value={provider}
                onInputChange={(e, val) => {
                  setProvider(val);
                  setCity("");
                  setLocationDetail("");
                }}
                renderInput={(params) => <TextField {...params} label="Provider" fullWidth size="small" />}
              />
            </Grid>
            <Grid item xs={12} sx={{ width: '100%', p: '0 !important', mb: { xs: 2, sm: 3 } }}>
              <Autocomplete
                freeSolo
                options={availableCities}
                value={city}
                onInputChange={(e, val) => {
                  setCity(val);
                  setLocationDetail("");
                }}
                renderInput={(params) => <TextField {...params} label="City" fullWidth size="small" />}
              />
            </Grid>
            <Grid item xs={12} sx={{ width: '100%', p: '0 !important', mb: { xs: 2, sm: 3 } }}>
              <Autocomplete
                freeSolo
                options={availableDetails}
                value={locationDetail}
                onInputChange={(e, val) => setLocationDetail(val)}
                renderInput={(params) => <TextField {...params} label="Charger" fullWidth size="small" />}
              />
            </Grid>

            {/* Plug and Power side by side (6-6) */}
            <Grid container item xs={12} spacing={2} sx={{ width: '100%', m: 0, p: '0 !important', mb: { xs: 2, sm: 3 } }}>
              <Grid item xs={6} sx={{ pl: '0 !important' }}>
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

              <Grid item xs={6} sx={{ pr: '0 !important' }}>
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
            </Grid>

            {/* Energy Info */}
            <Grid item xs={12} sx={{ width: '100%', p: '0 !important', mb: { xs: 2, sm: 3 } }}>
              <TextField
                fullWidth
                label="Total Energy"
                type="number"
                size="small"
                value={kwh}
                onChange={(e) => setKwh(e.target.value)}
                InputProps={{
                  endAdornment: <InputAdornment position="end">kWh</InputAdornment>,
                }}
              />
            </Grid>
            
            <Grid container item xs={12} spacing={2} sx={{ width: '100%', m: 0, p: '0 !important', mb: { xs: 2, sm: 3 } }}>
              <Grid item xs={8} sx={{ pl: '0 !important' }}>
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
              <Grid item xs={4} sx={{ pr: '0 !important' }}>
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
            </Grid>

            <Grid item xs={12} sx={{ width: '100%', p: '0 !important', mb: { xs: 1, sm: 2 } }}>
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
            
            <Grid item xs={12} sx={{ p: '0 !important' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center' }}>
                Price: <strong>{pricePerKwh}</strong> {currency}/kWh
              </Typography>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={loading || !kwh || !cost}
          startIcon={<Save />}
          sx={{ 
            width: '100%', // Mobilon jobb a teljes szélesség
            maxWidth: '300px',
            borderRadius: 3, 
            py: { xs: 1.2, sm: 1.8 }, 
            fontWeight: 'bold' 
          }}
        >
          {loading ? "Saving..." : "Save Session"}
        </Button>
      </Box>
    </Box>
  );
};

export default UploadChargingForm;
