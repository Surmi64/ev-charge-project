import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Download as DownloadIcon,
  Edit as EditIcon,
  Search as SearchIcon,
  UploadFile as UploadFileIcon,
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useDelayedLoading } from '../utils/useDelayedLoading';
import { getCategoryChipSx } from '../utils/categoryVisuals';
import { TimelineSectionSkeleton } from './SectionSkeletons';
import RecordDialog from './RecordDialog';
import RecurringExpenses from './RecurringExpenses';

const TYPE_FILTERS = [
  { value: 'all', label: 'Everything' },
  { value: 'session', label: 'Charging & fueling' },
  { value: 'expense', label: 'Costs' },
];

const formatCategory = (value = '') =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());

const getTypeChipSx = (theme, activityType) => {
  const color = activityType === 'session' ? theme.palette.primary.main : theme.palette.secondary.main;
  return {
    color,
    borderColor: alpha(color, 0.42),
    backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.1 : 0.14),
  };
};

/**
 * The single place records live.
 *
 * There used to be three screens over the same rows: /sessions listed charging and
 * fueling, /expenses listed costs, and /activity listed both and could edit either.
 * Only this one was reachable from the navigation, so the other two were duplicated
 * surface area. Recurring costs were the one thing /expenses had on its own and now
 * sit in the second tab.
 */
function Activity() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // The tab lives in the URL so it can be linked to (the dashboard alerts point
  // straight at Recurring) and so a refresh keeps you where you were.
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'recurring' ? 'recurring' : 'ledger';
  const setTab = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'ledger') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };
  const [activity, setActivity] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  // Skip the placeholder entirely when the data beats the delay.
  const showSkeleton = useDelayedLoading(loading);
  const [activityType, setActivityType] = useState('all');
  const [vehicleId, setVehicleId] = useState('all');
  const [search, setSearch] = useState('');
  const [csvImporting, setCsvImporting] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const fileInputRef = useRef(null);

  const buildQuery = useCallback(() => {
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (activityType !== 'all') params.set('activity_type', activityType);
    if (vehicleId !== 'all') params.set('vehicle_id', vehicleId);
    if (search.trim()) params.set('search', search.trim());
    return params;
  }, [activityType, vehicleId, search]);

  const loadActivity = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/activity?${buildQuery().toString()}`);
      if (!res.ok) throw new Error();
      setActivity(await res.json());
    } catch {
      toast.error('Could not load your records');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => {
    apiFetch('/api/vehicles?include_archived=true')
      .then((res) => (res.ok ? res.json() : []))
      .then(setVehicles)
      .catch(() => toast.error('Could not load vehicles'));
  }, []);

  // Debounce the search box, but not the first load: waiting 200ms before even
  // starting the request pushed the page past the skeleton delay, so it flashed a
  // placeholder for a single frame on arrival.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      loadActivity();
      return undefined;
    }
    const timeout = setTimeout(loadActivity, 200);
    return () => clearTimeout(timeout);
  }, [loadActivity]);

  const activeVehicles = useMemo(() => vehicles.filter((v) => !v.is_archived), [vehicles]);

  // The feed is a summary; editing needs the full underlying row.
  const handleEdit = async (item) => {
    setBusyId(item.id);
    try {
      const isSession = item.activity_type === 'session';
      const res = await apiFetch(isSession ? '/api/charging_sessions' : '/api/expenses');
      if (!res.ok) throw new Error();
      const rows = await res.json();
      const row = rows.find((r) => String(r.id) === String(item.id));
      if (!row) throw new Error('This record could no longer be found');

      setEditingRecord(
        isSession
          ? {
              id: row.id,
              type: row.session_type,
              vehicle_id: String(row.vehicle_id ?? ''),
              start_time: (row.start_time || '').slice(0, 16),
              end_time: (row.end_time || '').slice(0, 16),
              kwh: row.kwh ?? '',
              fuel_liters: row.fuel_liters ?? '',
              cost: row.cost_huf ?? '',
              source: row.source || 'manual',
              odometer: row.odometer ?? '',
              battery_level_start: row.battery_level_start ?? '',
              battery_level_end: row.battery_level_end ?? '',
              notes: row.notes || '',
            }
          : {
              id: row.id,
              type: 'cost',
              vehicle_id: row.vehicle_id ? String(row.vehicle_id) : '',
              category: row.category,
              cost: row.amount ?? '',
              currency: row.currency || 'HUF',
              date: (row.date || '').slice(0, 10),
              notes: row.description || '',
            },
      );
      setRecordOpen(true);
    } catch (error) {
      toast.error(error.message || 'Could not open this record');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    const item = pendingDelete;
    if (!item) return;
    const path = item.activity_type === 'session'
      ? `/api/charging_sessions/${item.id}`
      : `/api/expenses/${item.id}`;
    setBusyId(item.id);
    try {
      const res = await apiFetch(path, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Could not delete this record');
      }
      toast.success('Record deleted');
      setPendingDelete(null);
      loadActivity();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleExportCsv = async () => {
    try {
      const res = await apiFetch(`/api/activity/export.csv?${buildQuery().toString()}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'garageos-records.csv';
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    }
  };

  const handleCsvFilePicked = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    setCsvImporting(true);
    try {
      const res = await apiFetch('/api/activity/import-csv', { method: 'POST', body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || 'Import failed');
      const errorCount = Array.isArray(data.errors) ? data.errors.length : 0;
      const summary = `Imported ${data.imported_sessions || 0} sessions and ${data.imported_expenses || 0} costs`;
      toast.success(errorCount ? `${summary}, ${errorCount} rows skipped.` : `${summary}.`);
      if (errorCount) toast.warning(`Row ${data.errors[0].row}: ${data.errors[0].detail}`);
      loadActivity();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCsvImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const hasFilters = activityType !== 'all' || vehicleId !== 'all' || search.trim() !== '';

  return (
    <Box className="section-shell stagger">
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight="800" sx={{ mb: 0.5 }}>
            Records
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Everything you have logged, and the costs that repeat.
          </Typography>
        </Box>
        {tab === 'ledger' ? (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => { setEditingRecord(null); setRecordOpen(true); }}
          >
            Add record
          </Button>
        ) : null}
      </Stack>

      <Tabs value={tab} onChange={(_, next) => setTab(next)} sx={{ mb: 2 }}>
        <Tab value="ledger" label="Ledger" />
        <Tab value="recurring" label="Recurring" />
      </Tabs>

      {tab === 'recurring' ? (
        <RecurringExpenses />
      ) : (
        <>
          <Paper sx={{ p: 2, borderRadius: 4, mb: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.4fr 1fr 1fr auto' }, gap: 2, alignItems: 'start' }}>
              <TextField
                label="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>
                  ),
                }}
              />
              <TextField select label="Show" value={activityType} onChange={(e) => setActivityType(e.target.value)}>
                {TYPE_FILTERS.map((f) => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
              </TextField>
              <TextField select label="Vehicle" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <MenuItem value="all">All vehicles</MenuItem>
                {activeVehicles.map((v) => (
                  <MenuItem key={v.id} value={String(v.id)}>{v.name || `${v.make} ${v.model}`}</MenuItem>
                ))}
              </TextField>
              <Stack direction="row" spacing={1} sx={{ pt: { md: 1 } }}>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" hidden onChange={handleCsvFilePicked} />
                <Tooltip title="Import a CSV exported from GarageOS">
                  <span>
                    <IconButton onClick={() => fileInputRef.current?.click()} disabled={csvImporting}>
                      <UploadFileIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Export what you see as CSV">
                  <IconButton onClick={handleExportCsv}><DownloadIcon /></IconButton>
                </Tooltip>
              </Stack>
            </Box>
          </Paper>

          {showSkeleton ? (
            <TimelineSectionSkeleton />
          ) : loading ? null : activity.length === 0 ? (
            <Card sx={{ p: 4, borderRadius: 4, textAlign: 'center' }}>
              <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>
                {hasFilters ? 'Nothing matches those filters' : 'No records yet'}
              </Typography>
              <Typography color="text.secondary" sx={{ mb: 2 }}>
                {hasFilters
                  ? 'Try widening the search or clearing the vehicle filter.'
                  : 'Log a charge, a tank of fuel or a cost and it will show up here.'}
              </Typography>
              {hasFilters ? (
                <Button variant="outlined" onClick={() => { setSearch(''); setActivityType('all'); setVehicleId('all'); }}>
                  Clear filters
                </Button>
              ) : (
                <Button variant="contained" startIcon={<AddIcon />} onClick={() => { setEditingRecord(null); setRecordOpen(true); }}>
                  Add record
                </Button>
              )}
            </Card>
          ) : (
            <Paper sx={{ borderRadius: 4, px: 2 }}>
              {activity.map((item, index) => {
                const busy = busyId === item.id;
                return (
                  <Box key={`${item.activity_type}-${item.id}`}>
                    {index > 0 ? <Divider /> : null}
                    <Stack
                      direction={isMobile ? 'column' : 'row'}
                      spacing={1.5}
                      alignItems={isMobile ? 'flex-start' : 'center'}
                      justifyContent="space-between"
                      sx={{ py: 2 }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                          <Typography variant="subtitle1" fontWeight={700}>{item.title}</Typography>
                          <Chip size="small" variant="outlined" label={item.activity_type === 'session' ? 'Session' : 'Cost'} sx={getTypeChipSx(theme, item.activity_type)} />
                          <Chip size="small" variant="outlined" label={formatCategory(item.category)} sx={getCategoryChipSx(theme, item.category)} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(item.occurred_at).toLocaleDateString()} · {item.vehicle_name}
                          {item.description ? ` · ${item.description}` : ''}
                        </Typography>
                      </Box>

                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="subtitle1" fontWeight={700} sx={{ whiteSpace: 'nowrap' }}>
                          {Number(item.amount_huf).toLocaleString()} HUF
                        </Typography>
                        <Tooltip title="Edit record">
                          <span>
                            <IconButton size="small" color="primary" disabled={busy} onClick={() => handleEdit(item)}>
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title="Delete record">
                          <span>
                            <IconButton size="small" color="error" disabled={busy} onClick={() => setPendingDelete(item)}>
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </Box>
                );
              })}
            </Paper>
          )}
        </>
      )}

      <RecordDialog
        open={recordOpen}
        onClose={() => { setRecordOpen(false); setEditingRecord(null); }}
        onSaved={loadActivity}
        vehicles={vehicles}
        editing={editingRecord}
      />

      <Dialog open={!!pendingDelete} onClose={() => setPendingDelete(null)} fullWidth maxWidth="xs">
        <DialogTitle>Delete record</DialogTitle>
        <DialogContent>
          <Typography color="text.secondary">
            This permanently removes the {pendingDelete?.activity_type === 'session' ? 'session' : 'cost'} for {pendingDelete?.vehicle_name}.
          </Typography>
          {pendingDelete?.title ? (
            <Typography sx={{ mt: 1.5, fontWeight: 700 }}>{pendingDelete.title}</Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={busyId !== null}>Delete</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default Activity;
