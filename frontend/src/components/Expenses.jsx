import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Card,
  Chip,
  Stack,
  Tooltip,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Add as AddIcon,
  Autorenew as RecurringIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircleOutline as CheckCircleOutlineIcon,
  PauseCircleOutline as PauseIcon,
  PlayCircleOutline as PlayIcon,
} from '@mui/icons-material';
import { toast } from 'sonner';
import { TableSectionSkeleton } from './SectionSkeletons';
import { getCategoryBoxSx, getCategoryChipSx, getCategoryVisual } from '../utils/categoryVisuals';

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

const EMPTY_FORM = {
  vehicle_id: '',
  category: 'maintenance',
  amount: '',
  currency: 'HUF',
  date: new Date().toISOString().slice(0, 10),
  description: '',
};

const EMPTY_RECURRING_FORM = {
  vehicle_id: '',
  category: 'insurance',
  amount: '',
  currency: 'HUF',
  frequency: 'yearly',
  next_due_date: new Date().toISOString().slice(0, 10),
  description: '',
  is_active: true,
};

const RECURRING_FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

function Expenses() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const [expenses, setExpenses] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [recurringExpenses, setRecurringExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingReminder, setEditingReminder] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [recurringFormData, setRecurringFormData] = useState(EMPTY_RECURRING_FORM);
  const [expenseSubmitting, setExpenseSubmitting] = useState(false);
  const [recurringSubmitting, setRecurringSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [busyActionKey, setBusyActionKey] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);

  useEffect(() => {
    fetchExpenses();
    fetchVehicles();
    fetchRecurringExpenses();
  }, []);

  const fetchExpenses = async () => {
    try {
      const res = await fetch('/api/expenses', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch expenses');
      setExpenses(await res.json());
    } catch {
      toast.error('Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

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

  const fetchRecurringExpenses = async () => {
    try {
      const res = await fetch('/api/recurring-expenses', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) throw new Error('Failed to fetch recurring expenses');
      setRecurringExpenses(await res.json());
    } catch {
      toast.error('Failed to load recurring reminders');
    }
  };

  const getVehicleLabel = (vehicleId) => {
    const vehicle = vehicles.find((item) => item.id === vehicleId);
    if (!vehicle) return 'All vehicles';
    return vehicle.name || `${vehicle.make} ${vehicle.model}`;
  };

  const activeVehicles = vehicles.filter((vehicle) => !vehicle.is_archived);
  const getSelectableVehicles = () => {
    if (!editingExpense?.vehicle_id) {
      return activeVehicles;
    }
    return vehicles.filter((vehicle) => !vehicle.is_archived || vehicle.id === editingExpense.vehicle_id);
  };

  const handleOpen = (expense = null) => {
    if (expense) {
      setEditingExpense(expense);
      setFormData({
        vehicle_id: expense.vehicle_id ?? '',
        category: expense.category,
        amount: expense.amount,
        currency: expense.currency,
        date: expense.date?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        description: expense.description ?? '',
      });
    } else {
      setEditingExpense(null);
      setFormData(EMPTY_FORM);
    }
    setOpen(true);
  };

  const handleRecurringOpen = (reminder = null) => {
    if (reminder) {
      setEditingReminder(reminder);
      setRecurringFormData({
        vehicle_id: reminder.vehicle_id ?? '',
        category: reminder.category,
        amount: reminder.amount,
        currency: reminder.currency,
        frequency: reminder.frequency,
        next_due_date: reminder.next_due_date,
        description: reminder.description ?? '',
        is_active: !!reminder.is_active,
      });
    } else {
      setEditingReminder(null);
      setRecurringFormData(EMPTY_RECURRING_FORM);
    }
    setRecurringOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setEditingExpense(null);
    setFormData(EMPTY_FORM);
  };

  const handleRecurringClose = () => {
    setRecurringOpen(false);
    setEditingReminder(null);
    setRecurringFormData(EMPTY_RECURRING_FORM);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const url = editingExpense ? `/api/expenses/${editingExpense.id}` : '/api/expenses';
    const method = editingExpense ? 'PATCH' : 'POST';
    const payload = {
      vehicle_id: formData.vehicle_id === '' ? null : Number(formData.vehicle_id),
      category: formData.category,
      amount: Number(formData.amount),
      currency: formData.currency,
      date: formData.date,
      description: formData.description || null,
    };

    try {
      setExpenseSubmitting(true);
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save expense');
      }

      toast.success(editingExpense ? 'Expense updated' : 'Expense added');
      handleClose();
      fetchExpenses();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setExpenseSubmitting(false);
    }
  };

  const handleRecurringSubmit = async (event) => {
    event.preventDefault();
    const url = editingReminder ? `/api/recurring-expenses/${editingReminder.id}` : '/api/recurring-expenses';
    const method = editingReminder ? 'PATCH' : 'POST';
    const payload = {
      vehicle_id: recurringFormData.vehicle_id === '' ? null : Number(recurringFormData.vehicle_id),
      category: recurringFormData.category,
      amount: Number(recurringFormData.amount),
      currency: recurringFormData.currency,
      frequency: recurringFormData.frequency,
      next_due_date: recurringFormData.next_due_date,
      description: recurringFormData.description || null,
      is_active: recurringFormData.is_active,
    };

    try {
      setRecurringSubmitting(true);
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save recurring reminder');
      }

      toast.success(editingReminder ? 'Recurring reminder updated' : 'Recurring reminder added');
      handleRecurringClose();
      fetchRecurringExpenses();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setRecurringSubmitting(false);
    }
  };

  const handleDeleteRequest = (expense) => {
    setPendingDelete({ type: 'expense', id: expense.id, label: expense.description || 'this expense' });
  };

  const handleRecurringDeleteRequest = (reminder) => {
    setPendingDelete({ type: 'reminder', id: reminder.id, label: reminder.description || 'this recurring reminder' });
  };

  const handleDeleteDialogClose = () => {
    if (deleteSubmitting) return;
    setPendingDelete(null);
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;

    const url = pendingDelete.type === 'expense'
      ? `/api/expenses/${pendingDelete.id}`
      : `/api/recurring-expenses/${pendingDelete.id}`;
    const actionKey = `${pendingDelete.type}-${pendingDelete.id}-delete`;

    try {
      setDeleteSubmitting(true);
      setBusyActionKey(actionKey);
      const res = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || `Failed to delete ${pendingDelete.type === 'expense' ? 'expense' : 'recurring reminder'}`);
      }

      toast.success(pendingDelete.type === 'expense' ? 'Expense deleted' : 'Recurring reminder deleted');
      setPendingDelete(null);
      if (pendingDelete.type === 'expense') {
        fetchExpenses();
      } else {
        fetchRecurringExpenses();
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setDeleteSubmitting(false);
      setBusyActionKey('');
    }
  };

  const handleRecurringToggle = async (reminder) => {
    try {
      setBusyActionKey(`reminder-${reminder.id}-toggle`);
      const res = await fetch(`/api/recurring-expenses/${reminder.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ is_active: !reminder.is_active }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to update recurring reminder');
      }

      toast.success(reminder.is_active ? 'Recurring reminder paused' : 'Recurring reminder resumed');
      fetchRecurringExpenses();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyActionKey('');
    }
  };

  const handleLogRecurringExpense = async (reminder) => {
    try {
      setBusyActionKey(`reminder-${reminder.id}-log`);
      const res = await fetch(`/api/recurring-expenses/${reminder.id}/log-expense`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to log recurring expense');
      }

      toast.success('Expense logged from recurring reminder');
      fetchRecurringExpenses();
      fetchExpenses();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyActionKey('');
    }
  };

  const formatFrequencyLabel = (value) => RECURRING_FREQUENCIES.find((item) => item.value === value)?.label || value;

  const getRecurringSelectableVehicles = () => {
    if (!editingReminder?.vehicle_id) {
      return activeVehicles;
    }
    return vehicles.filter((vehicle) => !vehicle.is_archived || vehicle.id === editingReminder.vehicle_id);
  };
  const emptyStateSx = {
    p: { xs: 3, sm: 4 },
    borderRadius: 4,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 1,
  };

  if (loading) {
    return <TableSectionSkeleton rows={5} />;
  }

  return (
    <Box className="section-shell">
      <Typography variant="h4" fontWeight="800" sx={{ mb: 1 }}>
        Expenses
      </Typography>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
            Add Expense
          </Button>
          <Button variant="outlined" startIcon={<RecurringIcon />} onClick={() => handleRecurringOpen()}>
            Add Reminder
          </Button>
        </Box>
      </Box>

      <Paper sx={{ p: 2.5, borderRadius: 4, mb: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2 }}>
          <Box>
            <Typography variant="h6" fontWeight={700}>
              Recurring Reminders
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Track upcoming insurance and tax-style costs, then log them into real expenses when they are paid.
            </Typography>
          </Box>
        </Box>

        {recurringExpenses.length ? (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2 }}>
            {recurringExpenses.map((reminder) => {
              const rowBusy = busyActionKey.startsWith(`reminder-${reminder.id}-`) || (pendingDelete?.type === 'reminder' && pendingDelete.id === reminder.id && deleteSubmitting);

              return (
                <Card key={reminder.id} sx={{ ...getCategoryBoxSx(theme, reminder.category), opacity: reminder.is_active ? 1 : 0.72 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start', mb: 1.25 }}>
                  <Box>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center', mb: 0.5 }}>
                      <Chip
                        size="small"
                        label={EXPENSE_CATEGORIES.find((item) => item.value === reminder.category)?.label || reminder.category}
                        variant="outlined"
                        sx={getCategoryChipSx(theme, reminder.category)}
                      />
                      <Chip size="small" label={formatFrequencyLabel(reminder.frequency)} variant="outlined" />
                      {!reminder.is_active ? <Chip size="small" label="Paused" variant="outlined" /> : null}
                    </Box>
                    <Typography variant="h6" fontWeight={700}>
                      {Number(reminder.amount).toLocaleString()} {reminder.currency}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {getVehicleLabel(reminder.vehicle_id)}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    Due {reminder.next_due_date}
                  </Typography>
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                  {reminder.description || 'No description'}
                </Typography>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Typography variant="caption" color="text.secondary">
                    {reminder.last_logged_date ? `Last logged ${reminder.last_logged_date}` : 'Not logged yet'}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5 }}>
                    <Tooltip title={reminder.is_active ? 'Log expense now' : 'Paused reminders cannot be logged'}>
                      <span>
                        <IconButton size="small" color="success" onClick={() => handleLogRecurringExpense(reminder)} disabled={!reminder.is_active || rowBusy}>
                          <CheckCircleOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={reminder.is_active ? 'Pause reminder' : 'Resume reminder'}>
                      <span>
                        <IconButton size="small" onClick={() => handleRecurringToggle(reminder)} disabled={rowBusy}>
                          {reminder.is_active ? <PauseIcon fontSize="small" /> : <PlayIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Edit reminder">
                      <span>
                        <IconButton size="small" color="primary" onClick={() => handleRecurringOpen(reminder)} disabled={rowBusy}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete reminder">
                      <span>
                        <IconButton size="small" color="error" onClick={() => handleRecurringDeleteRequest(reminder)} disabled={rowBusy}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
                </Card>
              );
            })}
          </Box>
        ) : (
          <Paper variant="outlined" sx={emptyStateSx}>
            <Chip size="small" label="Recurring" variant="outlined" />
            <Typography variant="subtitle1" fontWeight={700}>
              No recurring reminders yet
            </Typography>
            <Typography color="text.secondary">
              Add insurance or tax reminders so GarageOS can keep the next due date visible and turn them into real expenses with one action.
            </Typography>
            <Button variant="outlined" startIcon={<RecurringIcon />} onClick={() => handleRecurringOpen()}>
              Add Reminder
            </Button>
          </Paper>
        )}
      </Paper>

      {isMobile ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {expenses.map((expense) => (
            <Card key={expense.id} sx={{ ...getCategoryBoxSx(theme, expense.category, { compact: true }), position: 'relative', overflow: 'hidden', p: 1.75 }}>
              <Box sx={{ position: 'absolute', inset: '0 auto 0 0', width: 3, background: `linear-gradient(180deg, ${alpha(getCategoryVisual(expense.category).color, 0.92)}, ${alpha(getCategoryVisual(expense.category).color, 0.28)})` }} />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Chip
                  size="small"
                  label={EXPENSE_CATEGORIES.find((item) => item.value === expense.category)?.label || expense.category}
                  variant="outlined"
                  sx={getCategoryChipSx(theme, expense.category)}
                />
                <Typography variant="caption">{expense.date?.slice(0, 10)}</Typography>
              </Box>
              <Typography variant="body2" sx={{ mb: 1, color: getCategoryVisual(expense.category).color, fontWeight: 700 }}>
                {Number(expense.amount).toLocaleString()} {expense.currency}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                {getVehicleLabel(expense.vehicle_id)}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {expense.description || 'No description'}
              </Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Logged expense
                </Typography>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <Tooltip title="Edit expense">
                    <span>
                      <IconButton size="small" onClick={() => handleOpen(expense)} disabled={busyActionKey === `expense-${expense.id}-delete`}><EditIcon fontSize="small" /></IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Delete expense">
                    <span>
                      <IconButton size="small" color="error" onClick={() => handleDeleteRequest(expense)} disabled={busyActionKey === `expense-${expense.id}-delete`}><DeleteIcon fontSize="small" /></IconButton>
                    </span>
                  </Tooltip>
                </Box>
              </Box>
            </Card>
          ))}
          {expenses.length === 0 && (
            <Paper variant="outlined" sx={emptyStateSx}>
              <Chip size="small" label="Expenses" variant="outlined" />
              <Typography variant="h6">
                No expenses yet
              </Typography>
              <Typography color="text.secondary">
                Add your first service, insurance, parking, or other cost.
              </Typography>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
                Add Expense
              </Button>
            </Paper>
          )}
        </Box>
      ) : (
        <TableContainer component={Paper} sx={{ borderRadius: 4, overflow: 'hidden', boxShadow: `0 0 10px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.05 : 0.08)}` }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Category</TableCell>
                <TableCell>Vehicle</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Amount</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {expenses.map((expense) => (
                <TableRow key={expense.id}>
                  <TableCell>
                    <Chip
                      size="small"
                      label={EXPENSE_CATEGORIES.find((item) => item.value === expense.category)?.label || expense.category}
                      variant="outlined"
                      sx={getCategoryChipSx(theme, expense.category)}
                    />
                  </TableCell>
                  <TableCell>{getVehicleLabel(expense.vehicle_id)}</TableCell>
                  <TableCell>{expense.date?.slice(0, 10)}</TableCell>
                  <TableCell>{expense.description || 'No description'}</TableCell>
                  <TableCell sx={{ color: getCategoryVisual(expense.category).color, fontWeight: 700 }}>
                    {Number(expense.amount).toLocaleString()} {expense.currency}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit expense">
                      <span>
                        <IconButton onClick={() => handleOpen(expense)} size="small" color="primary" disabled={busyActionKey === `expense-${expense.id}-delete`}><EditIcon /></IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete expense">
                      <span>
                        <IconButton onClick={() => handleDeleteRequest(expense)} size="small" color="error" disabled={busyActionKey === `expense-${expense.id}-delete`}><DeleteIcon /></IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              {expenses.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                    <Stack spacing={1} alignItems="center">
                      <Chip size="small" label="Expenses" variant="outlined" />
                      <Typography variant="h6">
                        No expenses yet
                      </Typography>
                      <Typography color="text.secondary">
                        Add your first service, insurance, parking, or other cost.
                      </Typography>
                      <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpen()}>
                        Add Expense
                      </Button>
                    </Stack>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit}>
          <DialogTitle>{editingExpense ? 'Edit Expense' : 'New Expense'}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField
              select
              label="Category"
              fullWidth
              value={formData.category}
              onChange={(event) => setFormData({ ...formData, category: event.target.value })}
            >
              {EXPENSE_CATEGORIES.map((category) => (
                <MenuItem key={category.value} value={category.value}>{category.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Vehicle"
              fullWidth
              value={formData.vehicle_id}
              onChange={(event) => setFormData({ ...formData, vehicle_id: event.target.value })}
            >
              <MenuItem value="">No specific vehicle</MenuItem>
              {getSelectableVehicles().map((vehicle) => (
                <MenuItem key={vehicle.id} value={vehicle.id}>
                  {(vehicle.name || `${vehicle.make} ${vehicle.model}`) + (vehicle.is_archived ? ' (Archived)' : '')}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Amount"
                type="number"
                fullWidth
                required
                value={formData.amount}
                onChange={(event) => setFormData({ ...formData, amount: event.target.value })}
              />
              <TextField
                label="Currency"
                select
                fullWidth
                value={formData.currency}
                onChange={(event) => setFormData({ ...formData, currency: event.target.value })}
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
              value={formData.date}
              onChange={(event) => setFormData({ ...formData, date: event.target.value })}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={3}
              value={formData.description}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose} disabled={expenseSubmitting}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={expenseSubmitting}>{expenseSubmitting ? 'Saving...' : 'Save'}</Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={recurringOpen} onClose={handleRecurringClose} maxWidth="sm" fullWidth>
        <form onSubmit={handleRecurringSubmit}>
          <DialogTitle>{editingReminder ? 'Edit Recurring Reminder' : 'New Recurring Reminder'}</DialogTitle>
          <DialogContent sx={{ display: 'grid', gap: 2, pt: 1 }}>
            <TextField
              select
              label="Category"
              fullWidth
              value={recurringFormData.category}
              onChange={(event) => setRecurringFormData({ ...recurringFormData, category: event.target.value })}
            >
              {EXPENSE_CATEGORIES.filter((category) => ['insurance', 'tax', 'inspection', 'maintenance', 'other'].includes(category.value)).map((category) => (
                <MenuItem key={category.value} value={category.value}>{category.label}</MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Vehicle"
              fullWidth
              value={recurringFormData.vehicle_id}
              onChange={(event) => setRecurringFormData({ ...recurringFormData, vehicle_id: event.target.value })}
            >
              <MenuItem value="">No specific vehicle</MenuItem>
              {getRecurringSelectableVehicles().map((vehicle) => (
                <MenuItem key={vehicle.id} value={vehicle.id}>
                  {(vehicle.name || `${vehicle.make} ${vehicle.model}`) + (vehicle.is_archived ? ' (Archived)' : '')}
                </MenuItem>
              ))}
            </TextField>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                label="Amount"
                type="number"
                fullWidth
                required
                value={recurringFormData.amount}
                onChange={(event) => setRecurringFormData({ ...recurringFormData, amount: event.target.value })}
              />
              <TextField
                label="Currency"
                select
                fullWidth
                value={recurringFormData.currency}
                onChange={(event) => setRecurringFormData({ ...recurringFormData, currency: event.target.value })}
              >
                <MenuItem value="HUF">HUF</MenuItem>
                <MenuItem value="EUR">EUR</MenuItem>
                <MenuItem value="USD">USD</MenuItem>
              </TextField>
            </Box>
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                select
                label="Frequency"
                fullWidth
                value={recurringFormData.frequency}
                onChange={(event) => setRecurringFormData({ ...recurringFormData, frequency: event.target.value })}
              >
                {RECURRING_FREQUENCIES.map((frequency) => (
                  <MenuItem key={frequency.value} value={frequency.value}>{frequency.label}</MenuItem>
                ))}
              </TextField>
              <TextField
                label="Next Due Date"
                type="date"
                fullWidth
                required
                value={recurringFormData.next_due_date}
                onChange={(event) => setRecurringFormData({ ...recurringFormData, next_due_date: event.target.value })}
                InputLabelProps={{ shrink: true }}
              />
            </Box>
            <TextField
              label="Description"
              fullWidth
              multiline
              minRows={3}
              value={recurringFormData.description}
              onChange={(event) => setRecurringFormData({ ...recurringFormData, description: event.target.value })}
              helperText="Optional memo, provider, or policy reference."
            />
            <TextField
              select
              label="Status"
              fullWidth
              value={recurringFormData.is_active ? 'active' : 'paused'}
              onChange={(event) => setRecurringFormData({ ...recurringFormData, is_active: event.target.value === 'active' })}
            >
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="paused">Paused</MenuItem>
            </TextField>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleRecurringClose} disabled={recurringSubmitting}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={recurringSubmitting}>{recurringSubmitting ? 'Saving...' : 'Save'}</Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={!!pendingDelete} onClose={handleDeleteDialogClose} maxWidth="xs" fullWidth>
        <DialogTitle>Delete item</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            {pendingDelete?.type === 'expense'
              ? 'This expense will be removed permanently.'
              : 'This recurring reminder will be removed permanently.'}
          </Typography>
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
}

export default Expenses;