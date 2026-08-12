/**
 * What goes into the analytics PDF.
 *
 * The export used to be one button and one file: everything the page was showing, for
 * the whole fleet. Two things it could not answer — a report about one car out of
 * five, and a report without the half of it a given reader does not care about — are
 * what this dialog is for.
 *
 * Two independent choices, because they act at different depths. Vehicles narrow the
 * *figures*: the selection is sent to the server and every total in the report is
 * recomputed over it. Sections only decide which blocks are rendered; the numbers in
 * the blocks that survive are unchanged.
 *
 * Sold cars are offered here and nowhere else. Deleting a vehicle with history archives
 * it, and archived means retired from reporting -- correct for a page about what the
 * fleet costs now, wrong for the one report anyone actually wants about a car they no
 * longer own. They are opt-in rather than on by default, so the ordinary export still
 * means "the fleet".
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { EXPORT_SECTIONS, DEFAULT_EXPORT_SECTIONS } from '../utils/exportSections';

const ExportOptionsDialog = ({
  open,
  onClose,
  onConfirm,
  vehicles = [],
  archivedVehicles = [],
  availability = {},
  projectionAvailable = false,
}) => {
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));

  const allVehicleIds = useMemo(() => vehicles.map((v) => String(v.id)), [vehicles]);
  const [selectedVehicles, setSelectedVehicles] = useState(allVehicleIds);
  const [sections, setSections] = useState(DEFAULT_EXPORT_SECTIONS);
  const [projection, setProjection] = useState(true);

  // Reset on every open rather than on mount: the dialog stays mounted between
  // exports, and a fleet that changed underneath it would otherwise leave a stale
  // vehicle id in the selection.
  useEffect(() => {
    if (!open) return;
    setSelectedVehicles(allVehicleIds);
    setSections(DEFAULT_EXPORT_SECTIONS);
    setProjection(true);
  }, [open, allVehicleIds]);

  const toggle = (list, setList) => (id) => {
    setList(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  };

  // "The whole fleet" is exactly the active set — same size and same members. Length
  // alone was enough while only active vehicles could be picked; now that a sold car can
  // be swapped in for a live one the count can match while the selection does not.
  const isSubset = selectedVehicles.length !== allVehicleIds.length
    || !allVehicleIds.every((id) => selectedVehicles.includes(id));
  // The forecast is produced for the whole fleet and cannot be re-cut per vehicle, so
  // a subset export drops it rather than printing a fleet estimate beside one car's
  // recorded spend. Adding a sold car counts as narrowing for the same reason: the
  // estimate covers the cars still on the road, not the one that left.
  const projectionOffered = projectionAvailable && !isSubset;

  const available = (section) => !section.needs || availability[section.needs];
  const chosenSections = sections.filter(
    (id) => available(EXPORT_SECTIONS.find((section) => section.id === id) || {}),
  );
  const canExport = selectedVehicles.length > 0 && chosenSections.length > 0;

  const handleConfirm = () => {
    onConfirm({
      // Ids go back out as numbers: they are a query parameter the backend reads as
      // integers, and String() was only ever for the checkbox identity.
      vehicleIds: isSubset ? selectedVehicles.map(Number) : null,
      sections: chosenSections,
      projection: projectionOffered && projection,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={compact}>
      <DialogTitle>Export PDF</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          <Box>
            <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mb: 0.5 }}>
              <Typography variant="subtitle2" fontWeight={700}>Vehicles</Typography>
              {/* Resets to the active fleet rather than to everything listed: with sold
                  cars on screen, a "Select all" that quietly pulled them in would change
                  what the report means. */}
              <Button size="small"
                onClick={() => setSelectedVehicles(isSubset ? allVehicleIds : [])}>
                {isSubset ? (archivedVehicles.length ? 'Whole fleet' : 'Select all') : 'Clear'}
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Every figure in the report is recalculated over what you pick here.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.25 }}>
              {vehicles.map((vehicle) => (
                <FormControlLabel
                  key={vehicle.id}
                  control={(
                    <Checkbox
                      size="small"
                      checked={selectedVehicles.includes(String(vehicle.id))}
                      onChange={() => toggle(selectedVehicles, setSelectedVehicles)(String(vehicle.id))}
                    />
                  )}
                  label={<Typography variant="body2">{vehicle.name}</Typography>}
                />
              ))}
            </Box>
            {archivedVehicles.length ? (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant="caption" color="text.secondary" fontWeight={700}
                  display="block" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  Sold and archived
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
                  Left out of the page and of every total by default. Tick one to report on
                  what it cost while you had it.
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.25 }}>
                  {archivedVehicles.map((vehicle) => (
                    <FormControlLabel
                      key={vehicle.id}
                      control={(
                        <Checkbox
                          size="small"
                          checked={selectedVehicles.includes(String(vehicle.id))}
                          onChange={() => toggle(selectedVehicles, setSelectedVehicles)(String(vehicle.id))}
                        />
                      )}
                      label={(
                        <Typography variant="body2" color="text.secondary">{vehicle.name}</Typography>
                      )}
                    />
                  ))}
                </Box>
              </Box>
            ) : null}
            {selectedVehicles.length === 0 ? (
              <Typography variant="caption" color="error">Pick at least one vehicle.</Typography>
            ) : null}
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>Sections</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Leave out what this report does not need. Pages repack around what is left.
            </Typography>
            <Stack spacing={0.25}>
              {EXPORT_SECTIONS.map((section) => {
                const enabled = available(section);
                return (
                  <FormControlLabel
                    key={section.id}
                    disabled={!enabled}
                    control={(
                      <Checkbox
                        size="small"
                        checked={enabled && sections.includes(section.id)}
                        onChange={() => toggle(sections, setSections)(section.id)}
                      />
                    )}
                    label={(
                      <Box>
                        <Typography variant="body2">{section.label}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {enabled ? section.hint : 'Nothing to show in this range.'}
                        </Typography>
                      </Box>
                    )}
                    sx={{ alignItems: 'flex-start', '& .MuiCheckbox-root': { pt: 0.25 } }}
                  />
                );
              })}
            </Stack>
            {chosenSections.length === 0 ? (
              <Typography variant="caption" color="error">Pick at least one section.</Typography>
            ) : null}
          </Box>

          {projectionAvailable ? (
            <>
              <Divider />
              <Box>
                <FormControlLabel
                  disabled={!projectionOffered}
                  control={(
                    <Checkbox size="small" checked={projectionOffered && projection}
                      onChange={(event) => setProjection(event.target.checked)} />
                  )}
                  label={<Typography variant="body2">Include the year-end projection</Typography>}
                />
                <Typography variant="caption" color="text.secondary" display="block">
                  {projectionOffered
                    ? 'Estimated months are hatched and labelled as estimates.'
                    : 'The projection covers the whole fleet, so it is left out of a per-vehicle report.'}
                </Typography>
              </Box>
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleConfirm} disabled={!canExport}>
          Export
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ExportOptionsDialog;
