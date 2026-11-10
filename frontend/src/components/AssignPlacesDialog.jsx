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
  const [saving, setSaving] = useState(false);
  const [filedCount, setFiledCount] = useState(null);
  const [changed, setChanged] = useState(0);

  useEffect(() => {
    if (!open) return;
    setGroups(null);
    setChanged(0);
    Promise.all([apiFetch('/api/places/unassigned'), apiFetch('/api/places')])
      .then(async ([groupRes, placeRes]) => {
        const loadedGroups = groupRes.ok ? await groupRes.json() : [];
        const loadedPlaces = placeRes.ok ? await placeRes.json() : [];
        setPlaces(loadedPlaces);
        // visit_count on the places list counts the records filed there.
        setFiledCount(loadedPlaces.reduce((sum, place) => sum + Number(place.visit_count || 0), 0));
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

  const draftFor = (group) => drafts[group.key] || { name: '', position: null };

  // What a group's current choice would file it under, or null if it is not finished:
  // nothing picked, or a new place still missing its name or its pin.
  const targetFor = (group) => {
    const picked = choice[group.key];
    if (!picked) return null;
    if (picked !== NEW_PLACE) return { place_id: Number(picked) };
    const draft = draftFor(group);
    if (!draft.name.trim() || !draft.position) return null;
    return { name: draft.name.trim(), ...draft.position };
  };

  const ready = (groups || []).filter((group) => targetFor(group));
  const unfinished = (groups || []).filter((group) => choice[group.key] === NEW_PLACE && !targetFor(group));

  // One save for everything filled in. The rows used to carry a button each, and closing
  // the dialog after picking places quietly threw the picks away.
  const saveAll = async () => {
    setSaving(true);
    let filed = 0;
    const done = new Set();
    // Two groups pinned as new places under the same name are one place: the first
    // creates it, the rest are filed under it rather than refused as a duplicate.
    const created = new Map();
    try {
      for (const group of ready) {
        const target = targetFor(group);
        const reuse = target.name ? created.get(target.name.toLowerCase()) : null;
        const body = { session_ids: group.session_ids, ...(reuse ? { place_id: reuse } : target) };
        const res = await apiFetch('/api/places/assign', { method: 'POST', body: JSON.stringify(body) });
        if (!res.ok) {
          toast.error(`${group.label || 'No description'}: ${await readError(res, 'could not be filed')}`);
          continue;
        }
        const result = await res.json();
        if (target.name && !reuse) {
          created.set(target.name.toLowerCase(), result.place.id);
          setPlaces((current) => [...current, {
            id: result.place.id, name: result.place.name,
            latitude: target.latitude, longitude: target.longitude, visit_count: result.assigned,
          }]);
          setChoice((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [
            key, value === NEW_PLACE && (drafts[key]?.name || '').trim().toLowerCase() === target.name.toLowerCase()
              ? String(result.place.id) : value,
          ])));
        }
        filed += result.assigned;
        done.add(group.key);
      }
    } finally {
      setSaving(false);
    }
    if (done.size) {
      setGroups((current) => current.filter((group) => !done.has(group.key)));
      toast.success(`${filed} record${filed === 1 ? '' : 's'} filed in ${done.size} group${done.size === 1 ? '' : 's'}`);
    }
    const total = changed + filed;
    setChanged(total);
    // Closed only when everything asked for went through; a failure or an unfinished pin
    // keeps the dialog open on exactly what is left.
    if (done.size === ready.length && !unfinished.length) onClose(total);
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
          they happened; pick one of your places for a group, or pin a new one on the map,
          then save. Where the words match a place you already have, it is picked for you —
          check it, or set it back to nothing to leave that group alone.
        </Typography>
        {filedCount != null ? (
          <Typography variant="body2" sx={{ mb: 2 }}>
            {filedCount} record{filedCount === 1 ? ' is' : 's are'} already filed under a place. Filed
            groups leave this list; their records are on the map.
          </Typography>
        ) : null}

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
            const draft = draftFor(group);
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
                      select size="small" label="Place" sx={{ minWidth: 240 }}
                      disabled={saving}
                      value={picked}
                      onChange={(event) => select(group, event.target.value)}
                    >
                      <MenuItem value=""><em>Leave for now</em></MenuItem>
                      {places.map((place) => (
                        <MenuItem key={place.id} value={String(place.id)}>
                          {place.name}{group.suggested_place_id === place.id ? ' (suggested)' : ''}
                        </MenuItem>
                      ))}
                      <MenuItem value={NEW_PLACE}>New place…</MenuItem>
                    </TextField>
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
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1, flexWrap: 'wrap' }}>
        {unfinished.length ? (
          <Typography variant="caption" color="warning.main" sx={{ mr: 'auto' }}>
            {unfinished.length} new place{unfinished.length === 1 ? ' still needs' : 's still need'} a name and a pin
          </Typography>
        ) : null}
        <Button onClick={() => onClose(changed)} disabled={saving}>{ready.length ? 'Cancel' : 'Close'}</Button>
        <Button variant="contained" onClick={saveAll} disabled={saving || !ready.length}>
          {saving ? 'Saving…' : ready.length
            ? `Save ${ready.length} group${ready.length === 1 ? '' : 's'}`
            : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AssignPlacesDialog;
