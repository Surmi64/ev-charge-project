import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { createFormatters } from '../utils/units';
import { DARK_TILE_FILTER, TILE_ATTRIBUTION, TILE_URL } from '../utils/mapTiles';

const NEW_PLACE = 'new';

// A charger description carries its power ("AC 22 kW"); a place name does not need it.
const suggestName = (label) => (label || '').replace(/\b(?:AC|DC)\s*\d+(?:[.,]\d+)?\s*(?:kW)?\b/gi, '').replace(/\s{2,}/g, ' ').trim();

const readError = async (res, fallback) => {
  const data = await res.json().catch(() => null);
  return data?.detail || fallback;
};

/** Click-to-place map for a new place: one marker, moved by clicking. */
const PlacePicker = ({ center, value, onChange, dark }) => {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(center.position, center.zoom);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.on('click', (event) => onChange({ latitude: event.latlng.lat, longitude: event.latlng.lng }));
    mapRef.current = map;
    // Mounted inside an opening dialog, the container can still be mid-transition when
    // Leaflet measures it, which leaves grey, unloaded tiles. Measure again once it lands.
    const settle = setTimeout(() => map.invalidateSize(), 250);
    return () => { clearTimeout(settle); map.remove(); mapRef.current = null; markerRef.current = null; };
    // Created once per picker; the centre is only where it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const position = [value.latitude, value.longitude];
    if (markerRef.current) markerRef.current.setLatLng(position);
    else markerRef.current = L.circleMarker(position, { radius: 9, weight: 3 }).addTo(map);
  }, [value]);

  return (
    <Box
      sx={{
        position: 'relative', height: 260, borderRadius: 2, overflow: 'hidden',
        border: 1, borderColor: 'divider', isolation: 'isolate', cursor: 'crosshair',
        '& .leaflet-tile-pane': dark ? { filter: DARK_TILE_FILTER } : {},
        '& .leaflet-control-attribution': { fontSize: 10 },
        '& .leaflet-container': { cursor: 'crosshair', font: 'inherit' },
      }}
    >
      <Box ref={containerRef} sx={{ position: 'absolute', inset: 0 }} />
    </Box>
  );
};

/**
 * Files older records under places, a whole group at a time.
 *
 * The server groups every record that has neither a place nor a coordinate by the
 * words that name its site ("Evse HK AC 22 kW"), and suggests an existing place where
 * the words match. Each group is then one decision: confirm the suggestion, pick
 * another place, or drop a pin for a new one.
 */
const AssignPlacesDialog = ({ open, onClose }) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const { user } = useAuth();
  const fmt = useMemo(() => createFormatters(user), [user]);
  const [groups, setGroups] = useState(null);
  const [places, setPlaces] = useState([]);
  const [choice, setChoice] = useState({});
  // A new place being drawn, per group: several can be open at once without sharing a pin.
  const [drafts, setDrafts] = useState({});
  const [busyKey, setBusyKey] = useState(null);
  const [changed, setChanged] = useState(0);

  useEffect(() => {
    if (!open) return;
    setGroups(null);
    setChanged(0);
    Promise.all([apiFetch('/api/places/unassigned'), apiFetch('/api/places')])
      .then(async ([groupRes, placeRes]) => {
        const loadedGroups = groupRes.ok ? await groupRes.json() : [];
        setPlaces(placeRes.ok ? await placeRes.json() : []);
        setGroups(loadedGroups);
        setChoice(Object.fromEntries(loadedGroups.map((group) => [
          group.key, group.suggested_place_id ? String(group.suggested_place_id) : '',
        ])));
      })
      .catch(() => {
        setGroups([]);
        toast.error('Could not load your records');
      });
  }, [open]);

  // Where a new pin starts: over the places the account already has, or Central Europe.
  const pickerCenter = useMemo(() => {
    if (!places.length) return { position: [47.5, 19.05], zoom: 7 };
    const lat = places.reduce((sum, place) => sum + place.latitude, 0) / places.length;
    const lng = places.reduce((sum, place) => sum + place.longitude, 0) / places.length;
    return { position: [lat, lng], zoom: 8 };
  }, [places]);

  const select = (group, value) => {
    setChoice((current) => ({ ...current, [group.key]: value }));
    if (value === NEW_PLACE && !drafts[group.key]) {
      setDrafts((current) => ({ ...current, [group.key]: { name: suggestName(group.label), position: null } }));
    }
  };

  const assign = async (group) => {
    const picked = choice[group.key];
    const body = { session_ids: group.session_ids };
    const draft = drafts[group.key] || { name: '', position: null };
    if (picked === NEW_PLACE) {
      if (!draft.name.trim() || !draft.position) {
        toast.error('Name the place and click where it is on the map');
        return;
      }
      Object.assign(body, { name: draft.name.trim(), ...draft.position });
    } else {
      body.place_id = Number(picked);
    }
    setBusyKey(group.key);
    try {
      const res = await apiFetch('/api/places/assign', { method: 'POST', body: JSON.stringify(body) });
      if (!res.ok) throw new Error(await readError(res, 'Could not file these records'));
      const result = await res.json();
      if (picked === NEW_PLACE) {
        setPlaces((current) => [...current, {
          id: result.place.id, name: result.place.name, ...draft.position, visit_count: result.assigned,
        }]);
      }
      setGroups((current) => current.filter((item) => item.key !== group.key));
      setChanged((count) => count + result.assigned);
      toast.success(`${result.assigned} record${result.assigned === 1 ? '' : 's'} filed under ${result.place.name}`);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusyKey(null);
    }
  };

  const describe = (group) => {
    const parts = [`${group.count} record${group.count === 1 ? '' : 's'}`];
    if (group.energy_kwh) parts.push(fmt.energy(group.energy_kwh));
    if (group.fuel_liters) parts.push(fmt.volume(group.fuel_liters));
    const first = new Date(group.first_at).toLocaleDateString();
    const last = new Date(group.last_at).toLocaleDateString();
    parts.push(first === last ? first : `${first} – ${last}`);
    return parts.join(' · ');
  };

  return (
    <Dialog open={open} onClose={() => onClose(changed)} fullScreen={fullScreen} maxWidth="md" fullWidth>
      <DialogTitle>Add places to older records</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          These records have no location. They are grouped by what they say about where
          they happened; file a group under one of your places, or pin a new one on the map.
          Where the words match a place you already have, it is picked for you — check it.
        </Typography>

        {groups === null ? (
          <Stack alignItems="center" sx={{ py: 6 }}><CircularProgress size={28} /></Stack>
        ) : null}

        {groups && groups.length === 0 ? (
          <Typography sx={{ py: 4, textAlign: 'center' }}>Every record has a place.</Typography>
        ) : null}

        <Stack divider={<Divider flexItem />} spacing={2}>
          {(groups || []).map((group) => {
            const picked = choice[group.key] ?? '';
            const isNew = picked === NEW_PLACE;
            const draft = drafts[group.key] || { name: '', position: null };
            const setDraft = (update) => setDrafts((current) => ({
              ...current, [group.key]: { ...draft, ...current[group.key], ...update },
            }));
            return (
              <Box key={group.key}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
                      {group.label || 'No description'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">{describe(group)}</Typography>
                  </Box>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField
                      select size="small" label="Place" sx={{ minWidth: 220 }}
                      value={picked}
                      onChange={(event) => select(group, event.target.value)}
                    >
                      <MenuItem value="" disabled>Choose a place</MenuItem>
                      {places.map((place) => (
                        <MenuItem key={place.id} value={String(place.id)}>
                          {place.name}{group.suggested_place_id === place.id ? ' (suggested)' : ''}
                        </MenuItem>
                      ))}
                      <MenuItem value={NEW_PLACE}>New place…</MenuItem>
                    </TextField>
                    <Button
                      variant="contained" size="small"
                      disabled={!picked || busyKey === group.key || (isNew && (!draft.position || !draft.name.trim()))}
                      onClick={() => assign(group)}
                      sx={{ minHeight: 40, flexShrink: 0 }}
                    >
                      {busyKey === group.key ? 'Filing…' : 'File'}
                    </Button>
                  </Stack>
                </Stack>

                {isNew ? (
                  <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                    <TextField
                      size="small" label="Name of the new place"
                      value={draft.name}
                      onChange={(event) => setDraft({ name: event.target.value })}
                    />
                    <PlacePicker
                      center={pickerCenter}
                      value={draft.position}
                      onChange={(position) => setDraft({ position })}
                      dark={theme.palette.mode === 'dark'}
                    />
                    <Typography variant="caption" color="text.secondary">
                      {draft.position ? 'Click again to move the pin.' : 'Click the map where this place is.'}
                    </Typography>
                  </Stack>
                ) : null}
              </Box>
            );
          })}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose(changed)}>Done</Button>
      </DialogActions>
    </Dialog>
  );
};

export default AssignPlacesDialog;
