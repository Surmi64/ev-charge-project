import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  MyLocation as LocateIcon,
  Place as PlaceIcon,
  Close as ClearIcon,
  CheckCircle as KnownIcon,
} from '@mui/icons-material';
import { apiFetch } from '../utils/api';
import { isGeolocationAvailable, useGeolocation, VAGUE_ACCURACY_M } from '../utils/useGeolocation';

/**
 * Where a charge or a fill-up happened.
 *
 * Two separable things, because they fail separately. The coordinate is what the phone
 * knows and the name is what the person knows, and either is useful without the other:
 * a fix with no name still groups repeat visits once one is given, and a name with no
 * fix still files the record against a place already on the list. So neither field
 * requires the other, and the whole section is skippable.
 *
 * Picking beats typing, because "MOL Váci út" and "Mol váci ut" are the same forecourt
 * to a human and two different places to a database. The suggestions are inline chips
 * rather than a dropdown: an Autocomplete popup is an overlay, and on a phone — where
 * the field and the locate button stack vertically — it opened over the button and
 * could only be dismissed by tapping the very thing it was covering. Chips push the
 * layout down instead of covering it, and there is nothing to close.
 */

// Enough to recognise a regular haunt without turning the dialog into a list. The
// account's places arrive most-visited first, so this keeps the ones actually worth
// offering.
const SUGGESTION_LIMIT = 6;
const LocationField = ({ value, onChange, disabled, autoLocate = false }) => {
  const [places, setPlaces] = useState([]);
  const [match, setMatch] = useState(null);
  const [matching, setMatching] = useState(false);
  const { position, status, error, locate, clear } = useGeolocation();

  const supported = isGeolocationAvailable();

  useEffect(() => {
    apiFetch('/api/places')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setPlaces(Array.isArray(data) ? data : []))
      // Silent: the suggestions are a convenience, and failing to load them must not
      // look like the record itself is in trouble.
      .catch(() => {});
  }, []);

  const lookup = useCallback(async (latitude, longitude) => {
    setMatching(true);
    try {
      const res = await apiFetch(`/api/places/nearby?latitude=${latitude}&longitude=${longitude}`);
      const data = res.ok ? await res.json() : null;
      setMatch(data?.match || null);
      return data?.match || null;
    } catch {
      return null;
    } finally {
      setMatching(false);
    }
  }, []);

  // A fresh fix arrives from the hook; push it into the form and ask what it matches.
  useEffect(() => {
    if (!position) return;
    // Coordinates only. This used to send `place_name` on both calls, which meant the
    // name the user was typing while the lookup was in flight got written back from a
    // stale closure. The parent merges, so leaving the key out keeps whatever is there.
    onChange({
      latitude: position.latitude,
      longitude: position.longitude,
      location_accuracy_m: position.accuracy_m,
    });
    lookup(position.latitude, position.longitude).then((found) => {
      // The fix landed within MATCH_RADIUS_M of a place already on the account, so fill
      // its name in. A name the user typed themselves wins — they know where they are
      // better than a 150 m radius does.
      if (found && !value.place_name) {
        onChange({ place_name: found.name });
      }
    });
    // onChange and value.place_name deliberately omitted: this must run when a new fix
    // lands, not every time the name is edited afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, lookup]);

  // Fetch the fix on open, so filing a record where you are is one field shorter.
  //
  // Gated on the permission already being granted, which is the difference between
  // convenience and a prompt nobody asked for. `getCurrentPosition` raises the browser's
  // own permission dialog on first use; firing that because someone opened a form is
  // how you get it dismissed, and a dismissal is sticky — after it the button is dead
  // too, and the feature is worse off than if it had never asked. Until the permission
  // exists the button is the way in; after that this never asks again.
  //
  // Never in edit mode: reopening a record from last week would quietly move it to
  // where you are standing now. The caller decides, and only passes this for new
  // records with no location yet.
  useEffect(() => {
    if (!autoLocate || !supported || disabled) return;
    if (value.latitude != null || value.longitude != null) return;
    if (!navigator.permissions?.query) return;

    let cancelled = false;
    navigator.permissions
      .query({ name: 'geolocation' })
      .then((permission) => {
        if (!cancelled && permission.state === 'granted') locate();
      })
      // Firefox once threw on an unsupported descriptor rather than rejecting the
      // promise; either way the answer is the same as 'prompt' — leave it to the button.
      .catch(() => {});

    return () => { cancelled = true; };
    // Runs once per open. `value` is read for the initial guard only: re-running it as
    // the coordinates arrive would fight the fix it just asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLocate, supported, disabled, locate]);

  const handleClear = () => {
    clear();
    setMatch(null);
    onChange({ latitude: null, longitude: null, location_accuracy_m: null, place_name: '' });
  };

  // What is in the field right now, normalised the same way a chip's label is, so the
  // one the user picked (or the button filled in) shows as selected.
  const selectedName = (value.place_name || '').trim().toLowerCase();

  // Narrowing as they type is what the dropdown did well, and it costs nothing to keep.
  // An exact match stays in the list rather than being filtered out, because that is
  // what marks the chip as selected — the confirmation that this is a place already on
  // the account, and not a near-miss spelling that will create a second one.
  const suggestions = useMemo(() => {
    const matching = selectedName
      ? places.filter((place) => place.name.trim().toLowerCase().includes(selectedName))
      : places;
    return matching.slice(0, SUGGESTION_LIMIT);
  }, [places, selectedName]);

  // Coerced rather than trusted. The API is supposed to send numbers, but a NUMERIC
  // column that reaches JSON as a string used to reach .toFixed here and throw during
  // render, which unmounts the whole dialog rather than degrading one chip. A location
  // is optional decoration on the record; it must never be able to do that.
  const lat = Number(value.latitude);
  const lon = Number(value.longitude);
  const hasFix = value.latitude != null && value.longitude != null
    && Number.isFinite(lat) && Number.isFinite(lon);
  const accuracy = Number(value.location_accuracy_m);
  const hasAccuracy = value.location_accuracy_m != null && Number.isFinite(accuracy);
  const vague = hasFix && hasAccuracy && accuracy > VAGUE_ACCURACY_M;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <PlaceIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" color="text.secondary">Location — optional</Typography>
      </Stack>

      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
          <TextField
            fullWidth
            disabled={disabled}
            label="Place"
            placeholder="MOL Váci út, Home…"
            value={value.place_name || ''}
            onChange={(event) => onChange({ place_name: event.target.value })}
            helperText={
              suggestions.length
                ? 'Type a name, tap one below, or let the button fill it in.'
                : places.length
                  ? 'No match among your places — this will be saved as a new one.'
                  : 'Name it once and it will be offered next time.'
            }
          />
          <Tooltip
            title={supported
              ? 'Read the coordinates from this device'
              : 'Your browser will only report a location over a secure (HTTPS) connection'}
          >
            <span>
              <Button
                variant="outlined"
                onClick={locate}
                disabled={disabled || !supported || status === 'locating'}
                startIcon={status === 'locating' ? <CircularProgress size={16} /> : <LocateIcon />}
                sx={{ whiteSpace: 'nowrap', mt: { xs: 0, sm: 1 } }}
              >
                {status === 'locating' ? 'Locating…' : 'Use my location'}
              </Button>
            </span>
          </Tooltip>
        </Stack>

        {suggestions.length ? (
          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
            {suggestions.map((place) => (
              <Chip
                key={place.id}
                size="small"
                variant={selectedName === place.name.trim().toLowerCase() ? 'filled' : 'outlined'}
                color={selectedName === place.name.trim().toLowerCase() ? 'primary' : 'default'}
                label={place.name}
                disabled={disabled}
                onClick={() => onChange({ place_name: place.name })}
                aria-label={`Use place ${place.name}`}
              />
            ))}
          </Stack>
        ) : null}

        {hasFix ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              icon={<PlaceIcon />}
              label={`${lat.toFixed(5)}, ${lon.toFixed(5)}${
                hasAccuracy ? ` · ±${Math.round(accuracy)} m` : ''
              }`}
            />
            {matching ? <CircularProgress size={14} /> : null}
            {match ? (
              <Chip
                size="small"
                color="success"
                variant="outlined"
                icon={<KnownIcon />}
                label={`Recognised — ${match.visit_count} previous ${match.visit_count === 1 ? 'visit' : 'visits'}, ${Math.round(match.distance_m)} m away`}
              />
            ) : null}
            <Tooltip title="Remove the location from this record">
              <IconButton size="small" onClick={handleClear} aria-label="Remove the location from this record">
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ) : null}

        {vague ? (
          <Alert severity="warning" sx={{ py: 0 }}>
            That fix is only accurate to about {Math.round(accuracy)} m, so it will be
            saved but not used to recognise a place. Naming it yourself will still work.
          </Alert>
        ) : null}

        {status === 'error' && error ? (
          <Alert severity="info" sx={{ py: 0 }} role="alert">{error}</Alert>
        ) : null}
      </Stack>
    </Box>
  );
};

export default LocationField;
