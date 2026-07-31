import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Autocomplete,
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
 * The name is an Autocomplete over places already used rather than a plain text field,
 * because "MOL Váci út" and "Mol váci ut" are the same forecourt to a human and two
 * different places to a database. Picking beats typing.
 */
const LocationField = ({ value, onChange, disabled }) => {
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
    onChange({
      latitude: position.latitude,
      longitude: position.longitude,
      location_accuracy_m: position.accuracy_m,
      // An existing name the user already typed wins — they know where they are better
      // than a 40 m radius does.
      place_name: value.place_name || '',
    });
    lookup(position.latitude, position.longitude).then((found) => {
      if (found && !value.place_name) {
        onChange({
          latitude: position.latitude,
          longitude: position.longitude,
          location_accuracy_m: position.accuracy_m,
          place_name: found.name,
        });
      }
    });
    // onChange and value.place_name deliberately omitted: this must run when a new fix
    // lands, not every time the name is edited afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position, lookup]);

  const handleClear = () => {
    clear();
    setMatch(null);
    onChange({ latitude: null, longitude: null, location_accuracy_m: null, place_name: '' });
  };

  const hasFix = value.latitude != null && value.longitude != null;
  const vague = hasFix && value.location_accuracy_m != null && value.location_accuracy_m > VAGUE_ACCURACY_M;

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <PlaceIcon fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="body2" color="text.secondary">Location — optional</Typography>
      </Stack>

      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'flex-start' }}>
          <Autocomplete
            freeSolo
            fullWidth
            disabled={disabled}
            options={places.map((place) => place.name)}
            value={value.place_name || ''}
            onInputChange={(_event, next) => onChange({ ...value, place_name: next })}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Place"
                placeholder="MOL Váci út, Home…"
                helperText={
                  places.length
                    ? 'Pick one you have used before, or type a new name.'
                    : 'Name it once and it will be offered next time.'
                }
              />
            )}
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

        {hasFix ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip
              size="small"
              icon={<PlaceIcon />}
              label={`${value.latitude.toFixed(5)}, ${value.longitude.toFixed(5)}${
                value.location_accuracy_m != null ? ` · ±${Math.round(value.location_accuracy_m)} m` : ''
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
            That fix is only accurate to about {Math.round(value.location_accuracy_m)} m, so it will be
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
