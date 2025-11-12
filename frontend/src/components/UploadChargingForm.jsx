import React, { useState, useEffect } from "react";
import {
  Box,
  Grid,
  TextField,
  MenuItem,
  Button,
  InputAdornment,
} from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";

const vehicles = [{ id: 1, label: "SSA511" }];
const currencies = ["HUF", "EUR", "USD"];
const API_URL = import.meta.env.VITE_API_URL || "http://100.104.111.43:5555";

const UploadChargingForm = () => {
  const [vehicleId, setVehicleId] = useState(1);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [kwh, setKwh] = useState("");
  const [duration, setDuration] = useState("");
  const [cost, setCost] = useState("");
  const [pricePerKwh, setPricePerKwh] = useState("");
  const [currency, setCurrency] = useState("HUF");
  const [notes, setNotes] = useState("");
  const [odometer, setOdometer] = useState("");
  const [noteOptions, setNoteOptions] = useState([]);

  // Example: fetch notes from API
  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const res = await fetch(`${API_URL}/charging_sessions/notes`);
        if (!res.ok) throw new Error("Failed to fetch notes");
        const data = await res.json();
        setNoteOptions([...new Set(data)]);
      } catch (err) {
        console.error(err);
      }
    };
    fetchNotes();
  }, []);

  useEffect(() => {
    if (startTime && endTime)
      setDuration((new Date(endTime) - new Date(startTime)) / 1000);
    if (kwh && cost)
      setPricePerKwh((parseFloat(cost) / parseFloat(kwh)).toFixed(2));
  }, [startTime, endTime, kwh, cost]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    // payload sending logic here...
    alert("Saved!");
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        width: "100%",
        maxWidth: 900,
        mx: "auto",
        p: { xs: 2, sm: 4 },
        backgroundColor: "#fff",
        borderRadius: 2,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
        textAlign: "left",
      }}
    >
      <Grid container spacing={2} sx={{ flexWrap: "wrap" }}>
        {/* Row 1: Vehicle, Start, End */}
        <Grid item xs={12} md={4} lg={4}>
          <TextField
            select
            label="Vehicle"
            fullWidth
            value={vehicleId}
            onChange={(e) => setVehicleId(parseInt(e.target.value))}
          >
            {vehicles.map((v) => (
              <MenuItem key={v.id} value={v.id}>
                {v.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} md={4} lg={4}>
          <TextField
            type="datetime-local"
            label="Start Time"
            fullWidth
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>
        <Grid item xs={12} md={4} lg={4}>
          <TextField
            type="datetime-local"
            label="End Time"
            fullWidth
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Grid>

        {/* Row 2: Duration, kWh */}
        <Grid item xs={12} md={6} lg={6}>
          <TextField
            label="Duration (s)"
            fullWidth
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Grid>
        <Grid item xs={12} md={6} lg={6}>
          <TextField
            label="kWh"
            fullWidth
            value={kwh}
            onChange={(e) => setKwh(e.target.value)}
          />
        </Grid>

        {/* Row 3: Cost, Currency */}
        <Grid item xs={12} md={6} lg={6} >
          <TextField
            label="Cost"
            fullWidth
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">{currency}</InputAdornment>
              ),
            }}
          />
        </Grid>
        <Grid item xs={12} md={6} lg={6}>
          <TextField
            select
            label="Currency"
            fullWidth
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
          >
            {currencies.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
        </Grid>

        {/* Row 4: Odometer, Notes */}
        <Grid item xs={12} md={4} lg={6}>
          <TextField
            label="Odometer (km)"
            type="number"
            fullWidth
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
          />
        </Grid>
        <Grid item xs={12} md={8} lg={6}>
          <Autocomplete
            freeSolo
            options={noteOptions}
            value={notes}
            onInputChange={(e, newValue) => setNotes(newValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Notes"
                placeholder="TEA Nyíregyháza Ledtechnika DC 60"
                fullWidth
                multiline
                minRows={3}
                
              />
            )}
          />
        </Grid>

        {/* Row 5: Save button */}
        <Grid item xs={12}>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            fullWidth
            sx={{ py: 1.5, fontSize: "1rem" }}
          >
            Save
          </Button>
        </Grid>
      </Grid>
    </Box>
  );
};

export default UploadChargingForm;

