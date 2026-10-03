import React from 'react';
import {
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import { Place as PlaceIcon } from '@mui/icons-material';
import { getCategoryChipSx } from '../utils/categoryVisuals';
import { formatCategoryLabel } from '../utils/expenseCategories';

const EMPTY = '—';

// What went in: kWh for a charge, volume for a fill-up. A hybrid record can carry
// both, so both are written rather than picking one.
const formatAmountIn = (item, fmt) => {
  const parts = [];
  if (item.energy_kwh != null && item.energy_kwh > 0) parts.push(fmt.energy(item.energy_kwh));
  if (item.fuel_liters != null && item.fuel_liters > 0) parts.push(fmt.volume(item.fuel_liters));
  return parts.length ? parts.join(' + ') : EMPTY;
};

// Price per unit, worked out from the record itself. Only when exactly one quantity is
// present: a cost split across kWh and litres has no single unit price.
const formatUnitPrice = (item, fmt) => {
  const kwh = Number(item.energy_kwh || 0);
  const litres = Number(item.fuel_liters || 0);
  const amount = Number(item.amount || 0);
  if (!amount) return EMPTY;
  if (kwh > 0 && !litres) return `${fmt.money(amount / kwh)} / kWh`;
  if (litres > 0 && !kwh) return `${fmt.fuelPrice(amount / litres)} / ${fmt.volumeShort}`;
  return EMPTY;
};

const formatBattery = (item) => {
  const start = item.battery_level_start;
  const end = item.battery_level_end;
  if (start == null && end == null) return null;
  return `${start ?? '?'} → ${end ?? '?'}%`;
};

/**
 * Records as a table: the same rows as the list, with the measurements the list
 * leaves out laid side by side so they can be compared down a column.
 *
 * Not sortable on purpose. The ledger is paged from the server newest first, and a
 * client-side sort would only reorder the pages already loaded while looking like it
 * covered everything.
 */
function RecordsTable({ items, fmt, renderActions, showVehicle = true }) {
  const theme = useTheme();
  const numeric = { align: 'right', sx: { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' } };
  // A column nobody on screen has a value for is a stripe of dashes. Named places are
  // optional and many accounts never enter them, so the column only appears once a
  // loaded record has one.
  const showLocation = items.some((item) => item.place_name);

  return (
    <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
      <TableContainer sx={{ overflowX: 'auto' }}>
        {/* Tighter than the theme's cells: ten columns have to fit beside the sidebar. */}
        <Table size="small" sx={{ '& .MuiTableCell-root': { px: 1.25 }, '& .MuiTableCell-root:first-of-type': { pl: 2 } }}>
          <TableHead>
            <TableRow>
              <TableCell>Date</TableCell>
              {showVehicle ? <TableCell>Vehicle</TableCell> : null}
              <TableCell>Record</TableCell>
              {showLocation ? <TableCell>Location</TableCell> : null}
              <TableCell align="right">Odometer</TableCell>
              <TableCell align="right">Energy</TableCell>
              <TableCell align="right">Unit price</TableCell>
              <TableCell align="right">Cost</TableCell>
              <TableCell align="right" aria-label="Actions" />
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={`${item.activity_type}-${item.id}`} hover>
                <TableCell sx={{ whiteSpace: 'nowrap' }}>
                  {new Date(item.occurred_at).toLocaleDateString()}
                </TableCell>
                {showVehicle ? (
                  <TableCell sx={{ maxWidth: 140 }}>
                    <Typography variant="body2" noWrap title={item.vehicle_name}>{item.vehicle_name}</Typography>
                  </TableCell>
                ) : null}
                <TableCell sx={{ minWidth: 140, maxWidth: 200 }}>
                  {/* The chip only when it adds something: most titles are the category
                      name, and "Charging [Charging]" spends the width the numbers need. */}
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={700} noWrap>{item.title}</Typography>
                    {formatCategoryLabel(item.category) !== item.title ? (
                      <Chip size="small" variant="outlined" label={formatCategoryLabel(item.category)}
                        sx={{ ...getCategoryChipSx(theme, item.category), flexShrink: 0 }} />
                    ) : null}
                  </Stack>
                  {item.description ? (
                    <Typography variant="caption" color="text.secondary" noWrap component="div" title={item.description}>
                      {item.description}
                    </Typography>
                  ) : null}
                </TableCell>
                {showLocation ? (
                <TableCell sx={{ maxWidth: 180 }}>
                  {item.place_name ? (
                    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
                      <PlaceIcon sx={{ fontSize: 16, color: 'text.secondary', flexShrink: 0 }} />
                      <Typography variant="body2" noWrap title={item.place_name}>{item.place_name}</Typography>
                    </Stack>
                  ) : (
                    <Typography variant="body2" color="text.disabled">{EMPTY}</Typography>
                  )}
                </TableCell>
                ) : null}
                <TableCell {...numeric}>
                  {item.odometer_km != null ? fmt.distance(item.odometer_km) : EMPTY}
                </TableCell>
                {/* Battery under the energy rather than in a column of its own: it
                    describes the same charge, and few records carry it. */}
                <TableCell {...numeric}>
                  {formatAmountIn(item, fmt)}
                  {formatBattery(item) ? (
                    <Typography variant="caption" color="text.secondary" component="div">
                      {formatBattery(item)}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell {...numeric}>{formatUnitPrice(item, fmt)}</TableCell>
                <TableCell {...numeric}>
                  <Typography variant="body2" fontWeight={700}>{fmt.money(item.amount)}</Typography>
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap', py: 0.5 }}>
                  {renderActions(item)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

export default RecordsTable;
