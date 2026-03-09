import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Chip, Checkbox, FormControlLabel
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Star as StarIcon, StarBorder as StarBorderIcon,
  EvStation as EvIcon, LocalGasStation as GasIcon
} from '@mui/icons-material';
import { toast } from 'sonner';

const FUEL_TYPES = [
  { value: 'electric', label: 'Electric', icon: <EvIcon fontSize="small" /> },
  { value: 'hybrid', label: 'Hybrid', icon: <EvIcon fontSize="small" /> },
  { value: 'petrol', label: 'Petrol', icon: <GasIcon fontSize="small" /> },
  { value: 'diesel', label: 'Diesel', icon: <GasIcon fontSize="small" /> },
];

const Vehicles = () => {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [formData, setFormData] = useState({
    name: '', make: '', model: '', fuel_type: 'electric',
    year: '', license_plate: '', battery_capacity_kwh: '', is_default: false
  });

  const fetchVehicles = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/vehicles', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error('Failed to fetch vehicles');
      const data = await response.json();
      setVehicles(data);
    } catch (err) {
      toast.error('Error fetching vehicles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVehicles(); }, []);

  const handleOpen = (vehicle = null) => {
    if (vehicle) {
      setEditingVehicle(vehicle);
      setFormData({
        name: vehicle.name || '', make: vehicle.make, model: vehicle.model,
        fuel_type: vehicle.fuel_type || 'electric', year: vehicle.year || '',
        license_plate: vehicle.license_plate || '',
        battery_capacity_kwh: vehicle.battery_capacity_kwh || '',
        is_default: !!vehicle.is_default
      });
    } else {
      setEditingVehicle(null);
      setFormData({
        name: '', make: '', model: '', fuel_type: 'electric',
        year: '', license_plate: '', battery_capacity_kwh: '', is_default: false
      });
    }
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const url = editingVehicle ? `/api/vehicles/${editingVehicle.id}` : '/api/vehicles';
    const method = editingVehicle ? 'PATCH' : 'POST';
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          ...formData,
          year: formData.year ? parseInt(formData.year) : null,
          battery_capacity_kwh: formData.battery_capacity_kwh ? parseFloat(formData.battery_capacity_kwh) : null
        })
      });
      if (!response.ok) throw new Error('Failed to save');
      toast.success(editingVehicle ? 'Vehicle updated' : 'Vehicle added');
      setOpen(false);
      fetchVehicles();
    } catch (err) { toast.error(err.message); }
  };

  const handleDelete = (id) => {
    toast.warning('Confirm deletion', {
      description: 'Delete this vehicle?',
      action: {
        label: 'Delete',
        onClick: async () => {
          try {
            await fetch(`/api/vehicles/${id}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            toast.success('Deleted');
            fetchVehicles();
          } catch (err) { toast.error('Error'); }
        }
      }
    });
  };

  const toggleDefault = async (vehicle) => {
    try {
      await fetch(`/api/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ is_default: !vehicle.is_default })
      });
      fetchVehicles();
    } catch (err) { toast.error('Error'); }
  };

  return (
    <Box>
      <Box display="flex" justifyContent="space-between" mb={3}>
        <Typography variant="h4" fontWeight={800}>Vehicles</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>Add Vehicle</Button>
      </Box>

      <TableContainer component={Paper} sx={{ borderRadius: 3 }}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell width={50}>Default</TableCell>
              <TableCell>Name / Identity</TableCell>
              <TableCell>Specs</TableCell>
              <TableCell>Fuel Type</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {vehicles.map((v) => (
              <TableRow key={v.id}>
                <TableCell>
                  <IconButton onClick={() => toggleDefault(v)} color={v.is_default ? "primary" : "default"}>
                    {v.is_default ? <StarIcon /> : <StarBorderIcon />}
                  </IconButton>
                </TableCell>
                <TableCell>
                  <Typography variant="subtitle1" fontWeight={600}>{v.name || 'Unnamed'}</Typography>
                  <Typography variant="caption" color="text.secondary">{v.license_plate || 'No plate'}</Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">{v.make} {v.model}</Typography>
                  <Typography variant="caption" color="text.secondary">{v.year}</Typography>
                </TableCell>
                <TableCell>
                  <Chip 
                    label={v.fuel_type} 
                    size="small" 
                    icon={FUEL_TYPES.find(f => f.value === v.fuel_type)?.icon} 
                    variant="outlined"
                  />
                </TableCell>
                <TableCell align="right">
                  <IconButton onClick={() => handleOpen(v)} size="small" color="primary"><EditIcon /></IconButton>
                  <IconButton onClick={() => handleDelete(v.id)} size="small" color="error"><DeleteIcon /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {vehicles.length === 0 && (
              <TableRow><TableCell colSpan={5} align="center" sx={{ py: 3 }}>No vehicles found. Add your first car!</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit}>
          <DialogTitle>{editingVehicle ? 'Edit Vehicle' : 'New Vehicle'}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField label="Nickname" fullWidth value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
            <Box display="flex" gap={2}>
              <TextField label="Make" required fullWidth value={formData.make} onChange={e => setFormData({...formData, make: e.target.value})} />
              <TextField label="Model" required fullWidth value={formData.model} onChange={e => setFormData({...formData, model: e.target.value})} />
            </Box>
            <Box display="flex" gap={2}>
              <TextField select label="Fuel Type" fullWidth value={formData.fuel_type} onChange={e => setFormData({...formData, fuel_type: e.target.value})}>
                {FUEL_TYPES.map(f => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
              </TextField>
              <TextField label="Year" type="number" fullWidth value={formData.year} onChange={e => setFormData({...formData, year: e.target.value})} />
            </Box>
            <TextField label="License Plate" fullWidth value={formData.license_plate} onChange={e => setFormData({...formData, license_plate: e.target.value})} />
            {(formData.fuel_type === 'electric' || formData.fuel_type === 'hybrid') && (
              <TextField label="Battery Capacity (kWh)" type="number" fullWidth value={formData.battery_capacity_kwh} onChange={e => setFormData({...formData, battery_capacity_kwh: e.target.value})} />
            )}
            <FormControlLabel 
              control={<Checkbox checked={formData.is_default} onChange={e => setFormData({...formData, is_default: e.target.checked})} />}
              label="Set as default vehicle"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="contained">Save</Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
};

export default Vehicles;
