import React, { useState, useEffect } from "react";
import {
  Box,
  TextField,
  MenuItem,
  Button,
  Grid,
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

  useEffect(() => {
    const fetchNotes = async () => {
      try {
        const res = await fetch(`${API_URL}/charging_sessions/notes`);
        if (!res.ok) throw new Error("Failed to fetch notes");
        const data = await res.json();

        // Expecting `data` as an array of note strings or objects like { notes: "..." }
        const allNotes = data
          .map((n) => (typeof n === "string" ? n : n.notes))
          .filter(Boolean);
        const uniqueNotes = [...new Set(allNotes)]; // remove duplicates
        setNoteOptions(uniqueNotes);
      } catch (err) {
        console.error("Error fetching notes:", err);
      }
    };

    fetchNotes();
  }, []);

  useEffect(() => {
    if (startTime && endTime) {
      const durationSeconds = (new Date(endTime) - new Date(startTime)) / 1000;
      setDuration(durationSeconds >= 0 ? durationSeconds : "");
    }
    if (kwh && cost) {
      const price = parseFloat(cost) / parseFloat(kwh);
      setPricePerKwh(!isNaN(price) ? price.toFixed(2) : "");
    }
  }, [startTime, endTime, kwh, cost]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {
      vehicle_id: vehicleId,
      start_time_posix: Math.floor(new Date(startTime).getTime() / 1000),
      end_time_posix: endTime
        ? Math.floor(new Date(endTime).getTime() / 1000)
        : null,
      kwh: kwh ? parseFloat(kwh) : null,
      duration_seconds: duration ? parseFloat(duration) : null,
      cost_huf: cost ? parseFloat(cost) : null,
      price_per_kwh: pricePerKwh ? parseFloat(pricePerKwh) : null,
      source: "frontend",
      currency,
      invoice_id: null,
      notes,
      provider: notes.split(" ")[0],
      ac_or_dc: notes.toLocaleLowerCase().split(" ").includes("dc")
        ? "DC"
        : "AC",
      kw: notes.split(" ")[notes.split(" ").length - 1],
      license_plate: vehicles.find((v) => v.id === vehicleId)?.label || null,
      odometer: odometer,
    };

    try {
      const response = await fetch(`${API_URL}/charging_sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        alert("Error: " + (errorData.error || "Unknown error"));
      } else {
        alert("Charging session saved successfully!");
        setStartTime("");
        setEndTime("");
        setKwh("");
        setDuration("");
        setCost("");
        setPricePerKwh("");
        setNotes("");
        setOdometer("");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save charging session. See console for details.");
    }
  };

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      sx={{
        maxWidth: 700,
        margin: "0 auto",
        p: { xs: 2, sm: 4 },
        backgroundColor: "#fff",
        borderRadius: 2,
        boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
      }}
    >
      <Grid
        container
        spacing={2}
        direction="column"
        justifyContent="center"
        alignItems="stretch"
        padding={2}
      >
        <div spacing={2}>
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
        </div>

        <div spacing={2}>
          <TextField
            type="datetime-local"
            label="Start Time"
            fullWidth
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            type="datetime-local"
            label="End Time"
            fullWidth
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </div>

        <div>
          <TextField
            label="kWh"
            fullWidth
            value={kwh}
            onChange={(e) => setKwh(e.target.value)}
          />

          <TextField
            label="Duration (s)"
            fullWidth
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </div>
        <div>
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

          <TextField
            label="Price per kWh"
            fullWidth
            value={pricePerKwh}
            onChange={(e) => setPricePerKwh(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">{currency}</InputAdornment>
              ),
            }}
          />
        </div>
        <div>
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

          <TextField
            label="Odometer (km)"
            name="odometer"
            type="number"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
            fullWidth
          />
        </div>
        <div>
          <Autocomplete
            freeSolo
            options={noteOptions}
            value={notes}
            minRows={4}
            onInputChange={(e, newValue) => setNotes(newValue)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Notes"
                placeholder="Keep this format: TEA Nyíregyháza Ledtechnika DC 60"
                fullWidth
              />
            )}
          />
        </div>
        <div>
          <Button type="submit" variant="contained" color="primary" fullWidth>
            Save
          </Button>
        </div>
      </Grid>
    </Box>
  );
};

export default UploadChargingForm;
