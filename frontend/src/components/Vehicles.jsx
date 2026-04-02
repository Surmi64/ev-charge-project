import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, IconButton, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Chip, Checkbox, FormControlLabel,
  Stack, InputAdornment, Alert, Tooltip
} from '@mui/material';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Star as StarIcon, StarBorder as StarBorderIcon,
  EvStation as EvIcon, LocalGasStation as GasIcon,
  ArchiveOutlined as ArchiveIcon,
  Unarchive as RestoreIcon,
  Palette as PaletteIcon,
  Route as RouteIcon,
  Notes as NotesIcon
} from '@mui/icons-material';
import { toast } from 'sonner';
import { requiresBatteryCapacity } from '../utils/vehicleRules';
import { getFuelBoxSx, getFuelChipSx } from '../utils/fuelVisuals';
import { TableSectionSkeleton } from './SectionSkeletons';

const FUEL_TYPES = [
  { value: 'electric', label: 'Electric', icon: <EvIcon fontSize="small" /> },
  { value: 'hybrid', label: 'Hybrid', icon: <EvIcon fontSize="small" /> },
  { value: 'petrol', label: 'Petrol', icon: <GasIcon fontSize="small" /> },
  { value: 'diesel', label: 'Diesel', icon: <GasIcon fontSize="small" /> },
];

const supportsFueling = (fuelType) => fuelType === 'hybrid' || fuelType === 'petrol' || fuelType === 'diesel';
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/i;

const getVehicleSpecs = (vehicle) => {
  const specs = [];

  if (vehicle.year) specs.push(String(vehicle.year));
  if (vehicle.battery_capacity_kwh) specs.push(`${Number(vehicle.battery_capacity_kwh).toLocaleString()} kWh battery`);
  if (vehicle.tank_capacity_liters) specs.push(`${Number(vehicle.tank_capacity_liters).toLocaleString()} L tank`);
  if (vehicle.starting_odometer_km) specs.push(`${Number(vehicle.starting_odometer_km).toLocaleString()} km start`);

  return specs.length ? specs.join(' • ') : 'No specs yet';
};

const validateVehicleForm = (formData) => {
  const errors = {};

  if (!formData.make.trim()) {
    errors.make = 'Make is required.';
  }

  if (!formData.model.trim()) {
    errors.model = 'Model is required.';
  }

  if (formData.year) {
    const year = Number(formData.year);
    if (!Number.isInteger(year) || year < 1950 || year > 2100) {
      errors.year = 'Year must be between 1950 and 2100.';
    }
  }

  if (formData.color_hex && !HEX_COLOR_PATTERN.test(formData.color_hex.trim())) {
    errors.color_hex = 'Use a hex color like #00F5FF.';
  }

  if (requiresBatteryCapacity(formData.fuel_type) && formData.battery_capacity_kwh && Number(formData.battery_capacity_kwh) < 0) {
    errors.battery_capacity_kwh = 'Battery capacity cannot be negative.';
  }

  if (supportsFueling(formData.fuel_type) && formData.tank_capacity_liters && Number(formData.tank_capacity_liters) < 0) {
    errors.tank_capacity_liters = 'Tank capacity cannot be negative.';
  }

  if (formData.starting_odometer_km && Number(formData.starting_odometer_km) < 0) {
    errors.starting_odometer_km = 'Starting odometer cannot be negative.';
  }

  return errors;
};

const Vehicles = () => {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState(null);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [submitSubmitting, setSubmitSubmitting] = useState(false);
  const [pendingDeleteVehicle, setPendingDeleteVehicle] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [busyVehicleId, setBusyVehicleId] = useState(null);
  const [formData, setFormData] = useState({
    name: '', make: '', model: '', fuel_type: 'electric',
    year: '', license_plate: '', battery_capacity_kwh: '', tank_capacity_liters: '',
    starting_odometer_km: '', color_hex: '#00F5FF', notes: '', is_default: false
  });

  const fetchVehicles = async () => {
    try {
      const response = await fetch('/api/vehicles?include_archived=true', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error('Failed to fetch vehicles');
      const data = await response.json();
      setVehicles(data);
    } catch {
      toast.error('Error fetching vehicles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVehicles(); }, []);

  const formErrors = validateVehicleForm(formData);
  const formIsValid = Object.keys(formErrors).length === 0;
  const activeVehicles = vehicles.filter((vehicle) => !vehicle.is_archived);
  const archivedVehicles = vehicles.filter((vehicle) => vehicle.is_archived);
  const visibleVehicles = showArchived ? vehicles : activeVehicles;

  if (loading) {
    return <TableSectionSkeleton rows={4} />;
  }

  const handleOpen = (vehicle = null) => {
    setSubmitAttempted(false);
    if (vehicle) {
      setEditingVehicle(vehicle);
      setFormData({
        name: vehicle.name || '', make: vehicle.make, model: vehicle.model,
        fuel_type: vehicle.fuel_type || 'electric', year: vehicle.year || '',
        license_plate: vehicle.license_plate || '',
        battery_capacity_kwh: vehicle.battery_capacity_kwh || '',
        tank_capacity_liters: vehicle.tank_capacity_liters || '',
        starting_odometer_km: vehicle.starting_odometer_km || '',
        color_hex: vehicle.color_hex || '#00F5FF',
        notes: vehicle.notes || '',
        is_default: !!vehicle.is_default
      });
    } else {
      setEditingVehicle(null);
      setFormData({
        name: '', make: '', model: '', fuel_type: 'electric',
        year: '', license_plate: '', battery_capacity_kwh: '', tank_capacity_liters: '',
        starting_odometer_km: '', color_hex: '#00F5FF', notes: '', is_default: false
      });
    }
    setOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitAttempted(true);
    if (!formIsValid) {
      toast.error('Fix the highlighted vehicle fields first.');
      return;
    }

    const url = editingVehicle ? `/api/vehicles/${editingVehicle.id}` : '/api/vehicles';
    const method = editingVehicle ? 'PATCH' : 'POST';
    try {
      setSubmitSubmitting(true);
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          ...formData,
          year: formData.year ? parseInt(formData.year) : null,
          battery_capacity_kwh: requiresBatteryCapacity(formData.fuel_type) && formData.battery_capacity_kwh
            ? parseFloat(formData.battery_capacity_kwh)
            : null,
          tank_capacity_liters: supportsFueling(formData.fuel_type) && formData.tank_capacity_liters
            ? parseFloat(formData.tank_capacity_liters)
            : null,
          starting_odometer_km: formData.starting_odometer_km ? parseFloat(formData.starting_odometer_km) : null,
          color_hex: formData.color_hex || null,
          notes: formData.notes.trim() || null
        })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to save');
      }
      toast.success(editingVehicle ? 'Vehicle updated' : 'Vehicle added');
      setOpen(false);
      fetchVehicles();
    } catch (error) {
      toast.error(error.message || 'Failed to save vehicle');
    } finally {
      setSubmitSubmitting(false);
    }
  };

  const handleDeleteRequest = (vehicle) => {
    if (busyVehicleId) {
      return;
    }

    setPendingDeleteVehicle(vehicle);
  };

  const handleDeleteDialogClose = () => {
    if (deleteSubmitting) {
      return;
    }

    setPendingDeleteVehicle(null);
  };

  const handleDelete = async () => {
    if (!pendingDeleteVehicle) {
      return;
    }

    try {
      setDeleteSubmitting(true);
      setBusyVehicleId(pendingDeleteVehicle.id);
      const response = await fetch(`/api/vehicles/${pendingDeleteVehicle.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to delete vehicle');
      }
      const result = await response.json().catch(() => ({}));
      toast.success(result.archived ? 'Vehicle archived' : 'Vehicle deleted');
      setPendingDeleteVehicle(null);
      fetchVehicles();
    } catch (error) {
      toast.error(error.message || 'Failed to delete vehicle');
    } finally {
      setDeleteSubmitting(false);
      setBusyVehicleId(null);
    }
  };

  const toggleArchive = async (vehicle) => {
    try {
      setBusyVehicleId(vehicle.id);
      const response = await fetch(`/api/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ is_archived: !vehicle.is_archived })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || 'Failed to update archive state');
      }
      toast.success(vehicle.is_archived ? 'Vehicle restored' : 'Vehicle archived');
      fetchVehicles();
    } catch (error) {
      toast.error(error.message || 'Failed to update archive state');
    } finally {
      setBusyVehicleId(null);
    }
  };

  const toggleDefault = async (vehicle) => {
    try {
      setBusyVehicleId(vehicle.id);
      await fetch(`/api/vehicles/${vehicle.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ is_default: !vehicle.is_default })
      });
      fetchVehicles();
    } catch {
      toast.error('Failed to update default vehicle');
    } finally {
      setBusyVehicleId(null);
    }
  };

  return (
    <Box className="section-shell">
      <Typography variant="h4" fontWeight={800} sx={{ mb: 1 }}>
        Vehicles
      </Typography>

      <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>Add Vehicle</Button>
        {archivedVehicles.length ? (
          <Button variant="outlined" onClick={() => setShowArchived((current) => !current)}>
            {showArchived ? 'Hide Archived' : `Show Archived (${archivedVehicles.length})`}
          </Button>
        ) : null}
      </Box>

      {visibleVehicles.length ? (
        <TableContainer component={Paper} sx={{ borderRadius: 4 }}>
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
              {visibleVehicles.map((v) => (
                <TableRow key={v.id} sx={v.is_archived ? { opacity: 0.62 } : undefined}>
                  <TableCell>
                    <IconButton onClick={() => toggleDefault(v)} color={v.is_default ? "primary" : "default"} disabled={v.is_archived || busyVehicleId === v.id}>
                      {v.is_default ? <StarIcon /> : <StarBorderIcon />}
                    </IconButton>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                      <Typography variant="subtitle1" fontWeight={600}>{v.name || 'Unnamed'}</Typography>
                      {v.is_archived ? <Chip size="small" label="Archived" variant="outlined" /> : null}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{v.license_plate || 'No plate'}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{v.make} {v.model}</Typography>
                    <Typography variant="caption" color="text.secondary">{getVehicleSpecs(v)}</Typography>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                      <Chip 
                        label={v.fuel_type} 
                        size="small" 
                        icon={FUEL_TYPES.find(f => f.value === v.fuel_type)?.icon} 
                        variant="outlined"
                        sx={(theme) => getFuelChipSx(theme, v.fuel_type)}
                      />
                      {v.color_hex ? (
                        <Chip
                          label={v.color_hex}
                          size="small"
                          icon={<PaletteIcon fontSize="small" />}
                          variant="outlined"
                          sx={{ '& .MuiChip-icon': { color: v.color_hex } }}
                        />
                      ) : null}
                    </Stack>
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit vehicle">
                      <span>
                        <IconButton onClick={() => handleOpen(v)} size="small" color="primary" disabled={busyVehicleId === v.id}><EditIcon /></IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={v.is_archived ? 'Restore vehicle' : 'Archive vehicle'}>
                      <span>
                        <IconButton onClick={() => toggleArchive(v)} size="small" color={v.is_archived ? 'success' : 'default'} disabled={busyVehicleId === v.id}>
                        {v.is_archived ? <RestoreIcon /> : <ArchiveIcon />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    {!v.is_archived ? (
                      <Tooltip title="Delete vehicle">
                        <span>
                          <IconButton onClick={() => handleDeleteRequest(v)} size="small" color="error" disabled={busyVehicleId === v.id}><DeleteIcon /></IconButton>
                        </span>
                      </Tooltip>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : (
        <Paper sx={{ p: 4, borderRadius: 4 }}>
          <Stack spacing={2.25} alignItems="flex-start">
            <Box>
              <Typography variant="h5" fontWeight={700} sx={{ mb: 0.75 }}>
                {vehicles.length ? 'No active vehicles' : 'Build your garage first'}
              </Typography>
              <Typography color="text.secondary">
                {vehicles.length
                  ? 'Your archived vehicles are preserved with their history. Restore one or add a new active vehicle to keep recording sessions and expenses.'
                  : 'Add a vehicle with its fuel type, identity, and baseline details so sessions, expenses, and analytics can attach to the right car.'}
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap>
              <Chip label="Set a default vehicle" variant="outlined" />
              <Chip label="Store EV or fuel specs" variant="outlined" />
              <Chip label="Keep color and notes" variant="outlined" />
              {archivedVehicles.length ? <Chip label="Restore archived history" variant="outlined" /> : null}
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
                {vehicles.length ? 'Add Another Vehicle' : 'Add Your First Vehicle'}
              </Button>
              {archivedVehicles.length ? (
                <Button variant="outlined" onClick={() => setShowArchived(true)}>
                  Show Archived Vehicles
                </Button>
              ) : null}
            </Stack>
          </Stack>
        </Paper>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit}>
          <DialogTitle>{editingVehicle ? 'Edit Vehicle' : 'New Vehicle'}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            {submitAttempted && !formIsValid ? (
              <Alert severity="warning">
                Review the highlighted fields before saving this vehicle.
              </Alert>
            ) : null}
            <TextField label="Nickname" fullWidth value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} helperText="Optional label for quick recognition in lists and forms." />
            <Box display="flex" gap={2}>
              <TextField label="Make" required fullWidth value={formData.make} onChange={e => setFormData({...formData, make: e.target.value})} error={submitAttempted && !!formErrors.make} helperText={submitAttempted ? formErrors.make || 'Required' : 'Required'} />
              <TextField label="Model" required fullWidth value={formData.model} onChange={e => setFormData({...formData, model: e.target.value})} error={submitAttempted && !!formErrors.model} helperText={submitAttempted ? formErrors.model || 'Required' : 'Required'} />
            </Box>
            <Box display="flex" gap={2}>
              <TextField select label="Fuel Type" fullWidth value={formData.fuel_type} onChange={e => setFormData({...formData, fuel_type: e.target.value, battery_capacity_kwh: requiresBatteryCapacity(e.target.value) ? formData.battery_capacity_kwh : '', tank_capacity_liters: supportsFueling(e.target.value) ? formData.tank_capacity_liters : ''})}>
                {FUEL_TYPES.map(f => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
              </TextField>
              <TextField label="Year" type="number" fullWidth value={formData.year} onChange={e => setFormData({...formData, year: e.target.value})} error={submitAttempted && !!formErrors.year} helperText={submitAttempted ? formErrors.year || 'Optional' : 'Optional'} />
            </Box>
            <TextField label="License Plate" fullWidth value={formData.license_plate} onChange={e => setFormData({...formData, license_plate: e.target.value})} helperText="Optional. Saved in uppercase automatically." />
            {(requiresBatteryCapacity(formData.fuel_type) || supportsFueling(formData.fuel_type)) ? (
              <Box sx={(theme) => getFuelBoxSx(theme, formData.fuel_type, { compact: true })}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} useFlexGap alignItems={{ xs: 'flex-start', sm: 'center' }} sx={{ mb: 1.5 }}>
                  <Chip
                    label={`${FUEL_TYPES.find((fuel) => fuel.value === formData.fuel_type)?.label || 'Fuel'} setup`}
                    size="small"
                    icon={FUEL_TYPES.find((fuel) => fuel.value === formData.fuel_type)?.icon}
                    variant="outlined"
                    sx={(theme) => getFuelChipSx(theme, formData.fuel_type)}
                  />
                  <Typography variant="body2" color="text.secondary">
                    Amber-brown neon edge with EV green and hybrid blue dominance.
                  </Typography>
                </Stack>
                <Box display="flex" gap={2}>
                  {requiresBatteryCapacity(formData.fuel_type) ? (
                    <TextField label="Battery Capacity (kWh)" type="number" fullWidth value={formData.battery_capacity_kwh} onChange={e => setFormData({...formData, battery_capacity_kwh: e.target.value})} error={submitAttempted && !!formErrors.battery_capacity_kwh} helperText={submitAttempted ? formErrors.battery_capacity_kwh || 'Optional for EVs and hybrids.' : 'Optional for EVs and hybrids.'} />
                  ) : null}
                  {supportsFueling(formData.fuel_type) ? (
                    <TextField label="Tank Capacity (L)" type="number" fullWidth value={formData.tank_capacity_liters} onChange={e => setFormData({...formData, tank_capacity_liters: e.target.value})} error={submitAttempted && !!formErrors.tank_capacity_liters} helperText={submitAttempted ? formErrors.tank_capacity_liters || 'Optional for hybrids and fuel vehicles.' : 'Optional for hybrids and fuel vehicles.'} />
                  ) : null}
                </Box>
              </Box>
            ) : null}
            <Box display="flex" gap={2}>
              <TextField
                label="Starting Odometer (km)"
                type="number"
                fullWidth
                value={formData.starting_odometer_km}
                onChange={e => setFormData({...formData, starting_odometer_km: e.target.value})}
                error={submitAttempted && !!formErrors.starting_odometer_km}
                helperText={submitAttempted ? formErrors.starting_odometer_km || 'Optional baseline for future cost-per-distance metrics.' : 'Optional baseline for future cost-per-distance metrics.'}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <RouteIcon fontSize="small" />
                    </InputAdornment>
                  )
                }}
              />
              <TextField
                label="Color"
                fullWidth
                value={formData.color_hex}
                onChange={e => setFormData({...formData, color_hex: e.target.value})}
                error={submitAttempted && !!formErrors.color_hex}
                helperText={submitAttempted ? formErrors.color_hex || 'Optional accent color for quick scanning.' : 'Optional accent color for quick scanning.'}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <PaletteIcon fontSize="small" sx={{ color: formData.color_hex || 'text.secondary' }} />
                    </InputAdornment>
                  )
                }}
              />
            </Box>
            <TextField
              label="Notes"
              fullWidth
              multiline
              minRows={3}
              value={formData.notes}
              onChange={e => setFormData({...formData, notes: e.target.value})}
              helperText="Optional service history, trim, or ownership notes."
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start" sx={{ alignSelf: 'flex-start', mt: 1.5 }}>
                    <NotesIcon fontSize="small" />
                  </InputAdornment>
                )
              }}
            />
            <FormControlLabel 
              control={<Checkbox checked={formData.is_default} onChange={e => setFormData({...formData, is_default: e.target.checked})} disabled={editingVehicle?.is_archived} />}
              label="Set as default vehicle"
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)} disabled={submitSubmitting}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={submitSubmitting}>{submitSubmitting ? 'Saving...' : 'Save'}</Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={!!pendingDeleteVehicle} onClose={handleDeleteDialogClose} fullWidth maxWidth="xs">
        <DialogTitle>Delete Vehicle</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            Delete this vehicle? If it already has linked history, GarageOS will archive it instead so those records stay intact.
          </Typography>
          {pendingDeleteVehicle ? (
            <Typography sx={{ mt: 1.5, fontWeight: 700 }}>
              {pendingDeleteVehicle.name || `${pendingDeleteVehicle.make} ${pendingDeleteVehicle.model}`}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteDialogClose} disabled={deleteSubmitting}>Cancel</Button>
          <Button onClick={handleDelete} color="error" variant="contained" disabled={deleteSubmitting}>
            {deleteSubmitting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Vehicles;
