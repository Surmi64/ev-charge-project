import React, { useState, useEffect } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, CircularProgress,
  IconButton, TextField
} from '@mui/material';
import { Edit, Save, Close } from '@mui/icons-material';

const API_URL = import.meta.env.VITE_API_URL || 'http://100.104.111.43:5555';

const formatPosix = (posix) => {
  if (!posix) return '-';
  const date = new Date(posix * 1000);
  return date.toISOString().replace('T', ' ').slice(0, 19);
};

const ListChargingSessions = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editRowId, setEditRowId] = useState(null);
  const [editValues, setEditValues] = useState({});

  useEffect(() => {
    fetch(`${API_URL}/charging_sessions`)
      .then(res => res.json())
      .then(data => {
        setSessions(data);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const handleEditClick = (session) => {
    setEditRowId(session.id);
    setEditValues(session);
  };

  const handleChange = (field, value) => {
    setEditValues({ ...editValues, [field]: value });
  };

  const handleSave = async () => {
    try {
      const res = await fetch(`${API_URL}/charging_sessions/${editRowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editValues),
      });
      if (!res.ok) throw new Error("Update failed");
      const updated = sessions.map(s =>
        s.id === editRowId ? { ...s, ...editValues } : s
      );
      setSessions(updated);
      setEditRowId(null);
    } catch (err) {
      console.error(err);
      alert("Failed to update record");
    }
  };

  if (loading) return <CircularProgress />;

  const columns = [
    { key: "id", label: "ID", editable: false },
    { key: "license_plate", label: "Vehicle" },
    { key: "start_time_posix", label: "Start Time" },
    { key: "end_time_posix", label: "End Time" },
    { key: "kwh", label: "kWh" },
    { key: "cost_huf", label: "Cost" },
    { key: "price_per_kwh", label: "Price/kWh" },
    { key: "notes", label: "Notes" },
    { key: "ac_or_dc", label: "AC or DC" },
    { key: "provider", label: "Provider" },
    { key: "kw", label: "kW" },
    { key: "odometer", label: "Odometer" },
    { key: "currency", label: "Currency" },
  ];

  return (
    <Box sx={{ width: "100%", maxWidth: "1400px", mx: "auto", mt: 2 }}>
      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map(col => (
                <TableCell key={col.key}>{col.label}</TableCell>
              ))}
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sessions.map((s) => (
              <TableRow key={s.id}>
                {columns.map((col) => (
                  <TableCell key={col.key} sx={{ padding: "6px 8px" }}>
                    {editRowId === s.id && col.editable !== false ? (
                      <TextField
                        value={editValues[col.key] ?? ""}
                        onChange={e => handleChange(col.key, e.target.value)}
                        size="small"
                        fullWidth
                        variant="outlined"
                      />
                    ) : (
                      col.key.includes("time_posix")
                        ? formatPosix(s[col.key])
                        : s[col.key]
                    )}
                  </TableCell>
                ))}
                <TableCell>
                  {editRowId === s.id ? (
                    <>
                      <IconButton onClick={handleSave}><Save /></IconButton>
                      <IconButton onClick={() => setEditRowId(null)}><Close /></IconButton>
                    </>
                  ) : (
                    <IconButton onClick={() => handleEditClick(s)}><Edit /></IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
};

export default ListChargingSessions;
