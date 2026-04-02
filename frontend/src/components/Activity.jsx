import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Card,
  Chip,
  Stack,
  Divider,
  TextField,
  MenuItem,
  InputAdornment,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Search as SearchIcon,
  Add as AddIcon,
  Download as DownloadIcon,
  UploadFile as UploadFileIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import { toast } from 'sonner';
import UploadChargingForm from './UploadChargingForm';
import { TimelineSectionSkeleton } from './SectionSkeletons';
import { getAllowedSessionTypes } from '../utils/vehicleRules';

const EXPENSE_CATEGORIES = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'parking', label: 'Parking' },
  { value: 'toll', label: 'Toll' },
  { value: 'tax', label: 'Tax' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'other', label: 'Other' },
];

const EMPTY_EXPENSE_FORM = {
  vehicle_id: '',
  category: 'maintenance',
  amount: '',
  currency: 'HUF',
  date: new Date().toISOString().slice(0, 10),
  description: '',
};

const EMPTY_SESSION_FORM = {
  id: null,
  vehicle_id: '',
  session_type: 'charging',
  start_time: '',
  end_time: '',
  kwh: '',
  fuel_liters: '',
  cost_huf: '',
  source: 'manual',
  notes: '',
  odometer: '',
};

const validateExpenseForm = (form) => {
  const errors = {};

  if (!form.category) {
    errors.category = 'Category is required.';
  }

  if (form.amount === '' || Number(form.amount) <= 0) {
    errors.amount = 'Amount must be greater than zero.';
  }

  if (!form.currency) {
    errors.currency = 'Currency is required.';
  }

  if (!form.date) {
    errors.date = 'Date is required.';
  }

  return errors;
};

const validateSessionForm = (form) => {
  const errors = {};

  if (!form.vehicle_id) {
    errors.vehicle_id = 'Vehicle is required.';
  }

  if (!form.session_type) {
    errors.session_type = 'Session type is required.';
  }

  if (!form.start_time) {
    errors.start_time = 'Start time is required.';
  }

  if (form.cost_huf === '' || Number(form.cost_huf) < 0) {
    errors.cost_huf = 'Cost must be zero or greater.';
  }

  if (form.session_type === 'fueling') {
    if (form.fuel_liters === '' || Number(form.fuel_liters) <= 0) {
      errors.fuel_liters = 'Fuel liters must be greater than zero.';
    }
  } else if (form.kwh === '' || Number(form.kwh) <= 0) {
    errors.kwh = 'Energy must be greater than zero.';
  }

  if (form.odometer !== '' && Number(form.odometer) < 0) {
    errors.odometer = 'Odometer cannot be negative.';
  }

  return errors;
};

const CATEGORY_COLORS = {
  charging: '#00F5FF',
  fueling: '#FFB547',
  maintenance: '#87FF65',
  insurance: '#6AC6FF',
  parking: '#9F7BFF',
  toll: '#FF8A5B',
  tax: '#FFD447',
  inspection: '#7CF2C9',
  cleaning: '#C7F464',
  other: '#B9C6D1',
};

const getTypeChipSx = (theme, activityType) => {
  const color = activityType === 'session' ? theme.palette.primary.main : theme.palette.secondary.main;

  return {
    color,
    borderColor: alpha(color, 0.42),
    backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.1 : 0.14),
  };
};

const getCategoryChipSx = (theme, category) => {
  const color = CATEGORY_COLORS[category] || theme.palette.text.secondary;

  return {
    color,
    borderColor: alpha(color, 0.34),
    backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.08 : 0.12),
  };
};

const getHistoricalChipSx = (theme) => ({
  color: theme.palette.warning.main,
  borderColor: alpha(theme.palette.warning.main, 0.38),
  backgroundColor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.1 : 0.14),
});

function Activity() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [activity, setActivity] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activityType, setActivityType] = useState('all');
  const [vehicleId, setVehicleId] = useState('all');
  const [search, setSearch] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionEditOpen, setSessionEditOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [sessionSubmitting, setSessionSubmitting] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState('');
  const [expenseSubmitAttempted, setExpenseSubmitAttempted] = useState(false);
  const [sessionSubmitAttempted, setSessionSubmitAttempted] = useState(false);
  const [expenseForm, setExpenseForm] = useState(EMPTY_EXPENSE_FORM);
  const [sessionForm, setSessionForm] = useState(EMPTY_SESSION_FORM);
  const fileInputRef = useRef(null);

  useEffect(() => {
    fetchVehicles();
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      const loadActivity = async () => {
        const params = new URLSearchParams();
        params.set('limit', '100');
        if (activityType !== 'all') params.set('activity_type', activityType);
        if (vehicleId !== 'all') params.set('vehicle_id', vehicleId);
        if (search.trim()) params.set('search', search.trim());

        try {
          const res = await fetch(`/api/activity?${params.toString()}`, {
            headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
          });
          if (!res.ok) throw new Error('Failed to fetch activity');
          setActivity(await res.json());
        } catch {
          toast.error('Failed to load activity');
        } finally {
          setLoading(false);
        }
      };

      loadActivity();
    }, 200);

    return () => clearTimeout(timeout);
  }, [activityType, vehicleId, search]);

  const fetchVehicles = async () => {
    try {
      const res = await fetch('/api/vehicles?include_archived=true', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch vehicles');
      setVehicles(await res.json());
    } catch {
      toast.error('Failed to load vehicles');
    }
  };

  const refreshActivity = () => {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (activityType !== 'all') params.set('activity_type', activityType);
    if (vehicleId !== 'all') params.set('vehicle_id', vehicleId);
    if (search.trim()) params.set('search', search.trim());

    fetch(`/api/activity?${params.toString()}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch activity');
        return res.json();
      })
      .then((data) => setActivity(data))
      .catch(() => toast.error('Failed to load activity'));
  };

  const expenseErrors = validateExpenseForm(expenseForm);
  const expenseFormValid = Object.keys(expenseErrors).length === 0;
  const sessionErrors = validateSessionForm(sessionForm);
  const sessionFormValid = Object.keys(sessionErrors).length === 0;

  const handleExpenseClose = () => {
    setExpenseOpen(false);
    setEditingExpense(null);
    setExpenseSubmitAttempted(false);
    setExpenseForm(EMPTY_EXPENSE_FORM);
  };

  const handleSessionEditClose = () => {
    setSessionEditOpen(false);
    setSessionSubmitAttempted(false);
    setSessionForm(EMPTY_SESSION_FORM);
  };

  const getVehicleFuelType = (currentVehicleId) => vehicles.find((vehicle) => vehicle.id === Number(currentVehicleId))?.fuel_type;
  const getSelectableVehicles = (currentVehicleId) => vehicles.filter((vehicle) => !vehicle.is_archived || vehicle.id === Number(currentVehicleId));

  const handleExpenseOpen = async (item = null) => {
    if (!item) {
      setEditingExpense(null);
      setExpenseSubmitAttempted(false);
      setExpenseForm(EMPTY_EXPENSE_FORM);
      setExpenseOpen(true);
      return;
    }

    try {
      setBusyActionKey(`edit-${item.activity_type}-${item.id}`);
      const res = await fetch('/api/expenses', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to load expense details');
      const expenses = await res.json();
      const expense = expenses.find((entry) => String(entry.id) === String(item.id));
      if (!expense) throw new Error('Expense not found');

      setEditingExpense(expense);
      setExpenseSubmitAttempted(false);
      setExpenseForm({
        vehicle_id: expense.vehicle_id ?? '',
        category: expense.category,
        amount: expense.amount,
        currency: expense.currency,
        date: expense.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        description: expense.description ?? '',
      });
      setExpenseOpen(true);
    } catch (error) {
      toast.error(error.message || 'Failed to load expense details');
    } finally {
      setBusyActionKey('');
    }
  };

  const handleSessionEditOpen = async (item) => {
    try {
      setBusyActionKey(`edit-${item.activity_type}-${item.id}`);
      const res = await fetch('/api/charging_sessions', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to load session details');
      const sessions = await res.json();
      const session = sessions.find((entry) => String(entry.id) === String(item.id));
      if (!session) throw new Error('Session not found');

      setSessionForm({
        id: session.id,
        vehicle_id: session.vehicle_id ?? '',
        session_type: session.session_type ?? 'charging',
        start_time: session.start_time ? session.start_time.slice(0, 16) : '',
        end_time: session.end_time ? session.end_time.slice(0, 16) : '',
        kwh: session.kwh ?? session.energy_kwh ?? '',
        fuel_liters: session.fuel_liters ?? '',
        cost_huf: session.cost_huf ?? '',
        source: session.source ?? 'manual',
        notes: session.notes ?? '',
        odometer: session.odometer ?? '',
      });
      setSessionSubmitAttempted(false);
      setSessionEditOpen(true);
    } catch (error) {
      toast.error(error.message || 'Failed to load session details');
    } finally {
      setBusyActionKey('');
    }
  };

  const handleExpenseSubmit = async (event) => {
    event.preventDefault();
    setExpenseSubmitAttempted(true);

    if (!expenseFormValid) {
      toast.error('Fix the highlighted expense fields first.');
      return;
    }

    try {
      setExpenseSubmitting(true);
      const res = await fetch(editingExpense ? `/api/expenses/${editingExpense.id}` : '/api/expenses', {
        method: editingExpense ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          vehicle_id: expenseForm.vehicle_id === '' ? null : Number(expenseForm.vehicle_id),
          category: expenseForm.category,
          amount: Number(expenseForm.amount),
          currency: expenseForm.currency,
          date: expenseForm.date,
          description: expenseForm.description || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save expense');
      }

      toast.success(editingExpense ? 'Expense updated' : 'Expense added');
      handleExpenseClose();
      refreshActivity();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setExpenseSubmitting(false);
    }
  };

  const handleSessionEditSubmit = async (event) => {
    event.preventDefault();
    setSessionSubmitAttempted(true);

    if (!sessionFormValid) {
      toast.error('Fix the highlighted session fields first.');
      return;
    }

    try {
      setSessionSubmitting(true);
      const res = await fetch(`/api/charging_sessions/${sessionForm.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          vehicle_id: Number(sessionForm.vehicle_id),
          session_type: sessionForm.session_type,
          start_time: sessionForm.start_time ? new Date(sessionForm.start_time).toISOString() : null,
          end_time: sessionForm.end_time ? new Date(sessionForm.end_time).toISOString() : null,
          kwh: sessionForm.session_type === 'charging' && sessionForm.kwh !== '' ? Number(sessionForm.kwh) : null,
          fuel_liters: sessionForm.session_type === 'fueling' && sessionForm.fuel_liters !== '' ? Number(sessionForm.fuel_liters) : null,
          cost_huf: Number(sessionForm.cost_huf),
          source: sessionForm.source || 'manual',
          notes: sessionForm.notes || null,
          odometer: sessionForm.odometer === '' ? null : Number(sessionForm.odometer),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to save session');
      }

      toast.success('Session updated');
      handleSessionEditClose();
      refreshActivity();
    } catch (error) {
      toast.error(error.message || 'Failed to save session');
    } finally {
      setSessionSubmitting(false);
    }
  };

  const handleDeleteRequest = (item) => {
    if (busyActionKey) {
      return;
    }

    setPendingDeleteItem(item);
  };

  const handleDeleteDialogClose = () => {
    if (deleteSubmitting) {
      return;
    }

    setPendingDeleteItem(null);
  };

  const handleDeleteActivity = async () => {
    if (!pendingDeleteItem) {
      return;
    }

    const item = pendingDeleteItem;
    const isSeededEntry = item.legacy_source === 'manual_seed';
    const endpoint = isSeededEntry
      ? `/api/activity/${item.event_id || item.id}`
      : item.activity_type === 'session'
        ? `/api/charging_sessions/${item.id}`
        : `/api/expenses/${item.id}`;
    const label = isSeededEntry ? 'historical entry' : item.activity_type === 'session' ? 'session' : 'expense';

    try {
      setDeleteSubmitting(true);
      setBusyActionKey(`delete-${item.activity_type}-${item.id}`);
      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to delete ${label}`);
      }
      toast.success(`${label.charAt(0).toUpperCase() + label.slice(1)} deleted`);
      setPendingDeleteItem(null);
      refreshActivity();
    } catch (error) {
      toast.error(error.message || `Failed to delete ${label}`);
    } finally {
      setDeleteSubmitting(false);
      setBusyActionKey('');
    }
  };

  const handleExportCsv = async () => {
    const params = new URLSearchParams();
    if (activityType !== 'all') params.set('activity_type', activityType);
    if (vehicleId !== 'all') params.set('vehicle_id', vehicleId);
    if (search.trim()) params.set('search', search.trim());

    try {
      const res = await fetch(`/api/activity/export.csv?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to export CSV');

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'garageos-activity-export.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success('CSV export downloaded');
    } catch (error) {
      toast.error(error.message || 'Failed to export CSV');
    }
  };

  const handleCsvFilePicked = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    setCsvImporting(true);

    try {
      const res = await fetch('/api/activity/import-csv', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to import CSV');
      }

      const errorCount = Array.isArray(data.errors) ? data.errors.length : 0;
      const summary = `Imported ${data.imported_sessions || 0} sessions and ${data.imported_expenses || 0} expenses`;
      toast.success(errorCount ? `${summary} with ${errorCount} row errors.` : `${summary}.`);
      if (errorCount) {
        const firstError = data.errors[0];
        toast.warning(`Row ${firstError.row}: ${firstError.detail}`);
      }
      refreshActivity();
    } catch (error) {
      toast.error(error.message || 'Failed to import CSV');
    } finally {
      setCsvImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const formatCategory = (value) => value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  const activeVehicles = vehicles.filter((vehicle) => !vehicle.is_archived);

  if (loading) {
    return <TimelineSectionSkeleton />;
  }

  return (
    <Box className="section-shell">
      <Typography variant="h4" fontWeight="800" sx={{ mb: 1 }}>
        Activity
      </Typography>

      <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={handleCsvFilePicked}
        />
        <Button variant="outlined" startIcon={<UploadFileIcon />} onClick={() => fileInputRef.current?.click()} disabled={csvImporting}>
          {csvImporting ? 'Importing...' : 'Import CSV'}
        </Button>
        <Button variant="outlined" startIcon={<DownloadIcon />} onClick={handleExportCsv}>
          Export CSV
        </Button>
        <Button variant="outlined" startIcon={<AddIcon />} onClick={() => handleExpenseOpen()}>
          Add Expense
        </Button>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setSessionOpen(true)}>
          Add Session
        </Button>
      </Box>

      <Paper sx={{ p: 2.25, borderRadius: 4, mb: 1, boxShadow: `0 0 10px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.05 : 0.08)}` }}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr 0.8fr' },
            gap: 2,
          }}
        >
          <TextField
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            helperText="CSV import expects the exported GarageOS activity columns and ISO dates."
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <TextField
            select
            label="Type"
            value={activityType}
            onChange={(event) => setActivityType(event.target.value)}
          >
            <MenuItem value="all">All activity</MenuItem>
            <MenuItem value="session">Sessions</MenuItem>
            <MenuItem value="expense">Expenses</MenuItem>
          </TextField>
          <TextField
            select
            label="Vehicle"
            value={vehicleId}
            onChange={(event) => setVehicleId(event.target.value)}
          >
            <MenuItem value="all">All vehicles</MenuItem>
            {vehicles.map((vehicle) => (
              <MenuItem key={vehicle.id} value={String(vehicle.id)}>
                {(vehicle.name || `${vehicle.make} ${vehicle.model}`) + (vehicle.is_archived ? ' (Archived)' : '')}
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </Paper>

      {activity.length ? (
        <Card sx={{ p: { xs: 2, sm: 3 }, borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
          <Box sx={{ position: 'absolute', inset: 'auto 0 0 0', height: 2, background: `linear-gradient(90deg, ${alpha(theme.palette.primary.main, 0.75)}, ${alpha(theme.palette.secondary.main, 0.28)}, transparent 92%)` }} />
          <Stack divider={<Divider flexItem />} spacing={0}>
            {activity.map((item) => (
              (() => {
                const typeTone = getTypeChipSx(theme, item.activity_type);
                const editActionKey = `edit-${item.activity_type}-${item.id}`;
                const deleteActionKey = `delete-${item.activity_type}-${item.id}`;
                const rowBusy = busyActionKey === editActionKey || busyActionKey === deleteActionKey;
                const canEdit = item.can_edit !== false;
                const canDelete = item.can_delete !== false;
                const isHistorical = item.legacy_source === 'manual_seed';

                return (
              <Box
                key={`${item.activity_type}-${item.id}`}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: isMobile ? 'flex-start' : 'center',
                  flexDirection: isMobile ? 'column' : 'row',
                  gap: 1.5,
                  py: 2,
                }}
              >
                <Box>
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {item.title}
                    </Typography>
                    <Chip
                      size="small"
                      label={item.activity_type === 'session' ? 'Session' : 'Expense'}
                      variant="outlined"
                      sx={typeTone}
                    />
                    <Chip
                      size="small"
                      label={formatCategory(item.category)}
                      variant="outlined"
                      sx={getCategoryChipSx(theme, item.category)}
                    />
                    {isHistorical ? (
                      <Chip
                        size="small"
                        label="Historical"
                        variant="outlined"
                        sx={getHistoricalChipSx(theme)}
                      />
                    ) : null}
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {item.vehicle_name} • {new Date(item.occurred_at).toLocaleString()}
                  </Typography>
                  {item.description ? (
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                      {item.description}
                    </Typography>
                  ) : null}
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, alignSelf: isMobile ? 'flex-end' : 'center' }}>
                  <Typography
                    variant="h6"
                    fontWeight={800}
                    sx={{ color: typeTone.color }}
                  >
                    {item.amount_huf.toLocaleString()} HUF
                  </Typography>
                  <Tooltip title={canEdit ? (item.activity_type === 'session' ? 'Edit session' : 'Edit expense') : 'Historical seeded entry cannot be edited'}>
                    <span>
                      <IconButton size="small" color="primary" disabled={rowBusy || !canEdit} onClick={() => (item.activity_type === 'session' ? handleSessionEditOpen(item) : handleExpenseOpen(item))}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={canDelete ? (item.activity_type === 'session' ? 'Delete session' : 'Delete expense') : 'Historical seeded entry cannot be deleted'}>
                    <span>
                      <IconButton size="small" color="error" disabled={rowBusy || !canDelete} onClick={() => handleDeleteRequest(item)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
                );
              })()
            ))}
          </Stack>
        </Card>
      ) : (
        <Paper sx={{ p: 4, borderRadius: 4 }}>
          <Typography variant="h6" sx={{ mb: 0.75 }}>
            No activity found
          </Typography>
          <Typography color="text.secondary">
            Change the filters or add a new session or expense.
          </Typography>
        </Paper>
      )}

      <Dialog open={sessionOpen} onClose={() => setSessionOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>New Session</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <UploadChargingForm
            vehicles={activeVehicles}
            onSuccess={() => {
              setSessionOpen(false);
              refreshActivity();
            }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={expenseOpen} onClose={handleExpenseClose} fullWidth maxWidth="sm">
        <form onSubmit={handleExpenseSubmit}>
          <DialogTitle>{editingExpense ? 'Edit Expense' : 'New Expense'}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            {expenseSubmitAttempted && !expenseFormValid ? (
              <Alert severity="warning">
                Review the highlighted expense fields before saving.
              </Alert>
            ) : null}
            <TextField
              select
              label="Category"
              fullWidth
              value={expenseForm.category}
              onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}
              error={expenseSubmitAttempted && !!expenseErrors.category}
              helperText={expenseSubmitAttempted ? expenseErrors.category || 'Required' : 'Required'}
            >
              {EXPENSE_CATEGORIES.map((category) => (
                <MenuItem key={category.value} value={category.value}>{category.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Vehicle"
              fullWidth
              value={expenseForm.vehicle_id}
              onChange={(event) => setExpenseForm({ ...expenseForm, vehicle_id: event.target.value })}
            >
              <MenuItem value="">No specific vehicle</MenuItem>
              {activeVehicles.map((vehicle) => (
                <MenuItem key={vehicle.id} value={vehicle.id}>
                  {vehicle.name || `${vehicle.make} ${vehicle.model}`}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Amount"
                type="number"
                fullWidth
                required
                value={expenseForm.amount}
                onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })}
                error={expenseSubmitAttempted && !!expenseErrors.amount}
                helperText={expenseSubmitAttempted ? expenseErrors.amount || 'Required' : 'Required'}
              />
              <TextField
                label="Currency"
                select
                fullWidth
                value={expenseForm.currency}
                onChange={(event) => setExpenseForm({ ...expenseForm, currency: event.target.value })}
                error={expenseSubmitAttempted && !!expenseErrors.currency}
                helperText={expenseSubmitAttempted ? expenseErrors.currency || 'Required' : 'Required'}
              >
                <MenuItem value="HUF">HUF</MenuItem>
                <MenuItem value="EUR">EUR</MenuItem>
                <MenuItem value="USD">USD</MenuItem>
              </TextField>
            </Box>
            <TextField
              label="Date"
              type="date"
              fullWidth
              required
              value={expenseForm.date}
              onChange={(event) => setExpenseForm({ ...expenseForm, date: event.target.value })}
              error={expenseSubmitAttempted && !!expenseErrors.date}
              helperText={expenseSubmitAttempted ? expenseErrors.date || 'Required' : 'Required'}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={3}
              value={expenseForm.description}
              onChange={(event) => setExpenseForm({ ...expenseForm, description: event.target.value })}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleExpenseClose} disabled={expenseSubmitting}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={expenseSubmitting || !expenseFormValid}>{expenseSubmitting ? 'Saving...' : 'Save'}</Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={sessionEditOpen} onClose={handleSessionEditClose} fullWidth maxWidth="sm">
        <form onSubmit={handleSessionEditSubmit}>
          <DialogTitle>Edit Session</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            {sessionSubmitAttempted && !sessionFormValid ? (
              <Alert severity="warning">
                Review the highlighted session fields before saving.
              </Alert>
            ) : null}
            <TextField
              select
              label="Vehicle"
              fullWidth
              value={sessionForm.vehicle_id}
              onChange={(event) => setSessionForm((current) => ({ ...current, vehicle_id: event.target.value }))}
              error={sessionSubmitAttempted && !!sessionErrors.vehicle_id}
              helperText={sessionSubmitAttempted ? sessionErrors.vehicle_id || 'Required' : 'Required'}
            >
              {getSelectableVehicles(sessionForm.vehicle_id).map((vehicle) => (
                <MenuItem key={vehicle.id} value={vehicle.id}>
                  {(vehicle.name || `${vehicle.make} ${vehicle.model}`) + (vehicle.is_archived ? ' (Archived)' : '')}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Session Type"
              fullWidth
              value={sessionForm.session_type}
              onChange={(event) => setSessionForm((current) => ({
                ...current,
                session_type: event.target.value,
                kwh: event.target.value === 'charging' ? current.kwh : '',
                fuel_liters: event.target.value === 'fueling' ? current.fuel_liters : '',
              }))}
              error={sessionSubmitAttempted && !!sessionErrors.session_type}
              helperText={sessionSubmitAttempted ? sessionErrors.session_type || 'Required' : 'Required'}
            >
              {getAllowedSessionTypes(getVehicleFuelType(sessionForm.vehicle_id)).map((type) => (
                <MenuItem key={type} value={type}>{type === 'charging' ? 'Charging' : 'Fueling'}</MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Start time"
                type="datetime-local"
                fullWidth
                required
                value={sessionForm.start_time}
                onChange={(event) => setSessionForm((current) => ({ ...current, start_time: event.target.value }))}
                error={sessionSubmitAttempted && !!sessionErrors.start_time}
                helperText={sessionSubmitAttempted ? sessionErrors.start_time || 'Required' : 'Required'}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="End time"
                type="datetime-local"
                fullWidth
                value={sessionForm.end_time}
                onChange={(event) => setSessionForm((current) => ({ ...current, end_time: event.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label={sessionForm.session_type === 'fueling' ? 'Fuel liters' : 'Energy (kWh)'}
                type="number"
                fullWidth
                required
                value={sessionForm.session_type === 'fueling' ? sessionForm.fuel_liters : sessionForm.kwh}
                onChange={(event) => setSessionForm((current) => ({
                  ...current,
                  [current.session_type === 'fueling' ? 'fuel_liters' : 'kwh']: event.target.value,
                }))}
                error={sessionSubmitAttempted && !!(sessionForm.session_type === 'fueling' ? sessionErrors.fuel_liters : sessionErrors.kwh)}
                helperText={sessionSubmitAttempted
                  ? (sessionForm.session_type === 'fueling' ? sessionErrors.fuel_liters : sessionErrors.kwh) || 'Required'
                  : 'Required'}
              />
              <TextField
                label="Cost (HUF)"
                type="number"
                fullWidth
                required
                value={sessionForm.cost_huf}
                onChange={(event) => setSessionForm((current) => ({ ...current, cost_huf: event.target.value }))}
                error={sessionSubmitAttempted && !!sessionErrors.cost_huf}
                helperText={sessionSubmitAttempted ? sessionErrors.cost_huf || 'Required' : 'Required'}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Odometer"
                type="number"
                fullWidth
                value={sessionForm.odometer}
                onChange={(event) => setSessionForm((current) => ({ ...current, odometer: event.target.value }))}
                error={sessionSubmitAttempted && !!sessionErrors.odometer}
                helperText={sessionSubmitAttempted ? sessionErrors.odometer || 'Optional' : 'Optional'}
              />
              <TextField
                label="Source"
                fullWidth
                value={sessionForm.source}
                onChange={(event) => setSessionForm((current) => ({ ...current, source: event.target.value }))}
              />
            </Box>
            <TextField
              label="Notes"
              fullWidth
              multiline
              minRows={3}
              value={sessionForm.notes}
              onChange={(event) => setSessionForm((current) => ({ ...current, notes: event.target.value }))}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleSessionEditClose} disabled={sessionSubmitting}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={sessionSubmitting || !sessionFormValid}>{sessionSubmitting ? 'Saving...' : 'Save'}</Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={!!pendingDeleteItem} onClose={handleDeleteDialogClose} fullWidth maxWidth="xs">
        <DialogTitle>
          Delete {pendingDeleteItem?.legacy_source === 'manual_seed' ? 'Historical Entry' : pendingDeleteItem?.activity_type === 'session' ? 'Session' : 'Expense'}
        </DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            {pendingDeleteItem
              ? pendingDeleteItem.legacy_source === 'manual_seed'
                ? `This will permanently remove the seeded historical activity entry for ${pendingDeleteItem.vehicle_name}.`
                : `This will permanently remove the ${pendingDeleteItem.activity_type} entry for ${pendingDeleteItem.vehicle_name}.`
              : ''}
          </Typography>
          {pendingDeleteItem?.title ? (
            <Typography sx={{ mt: 1.5, fontWeight: 700 }}>
              {pendingDeleteItem.title}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteDialogClose} disabled={deleteSubmitting}>Cancel</Button>
          <Button onClick={handleDeleteActivity} color="error" variant="contained" disabled={deleteSubmitting}>
            {deleteSubmitting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Activity;