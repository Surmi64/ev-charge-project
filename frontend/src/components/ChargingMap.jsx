import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { createFormatters } from '../utils/units';
import { DARK_TILE_FILTER, TILE_ATTRIBUTION, TILE_URL } from '../utils/mapTiles';
import AssignPlacesDialog from './AssignPlacesDialog';

const MAP_HEIGHT = { xs: 300, md: 380 };

const radiusFor = (visits, maxVisits) => 6 + 16 * Math.sqrt(visits / Math.max(maxVisits, 1));

const reducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Where the account charges and fuels, on a map: a dot per place, sized by how often
 * it is used and coloured by its provider. Covers the same range and vehicles as the
 * rest of the Analytics page.
 *
 * The colours are the Providers rings' own, handed down as `providerColors` (keyed by
 * the lower-cased name, as the server files each point): a provider is one colour
 * wherever it appears on the page. Providers past the rings' top five share the
 * rings' "more" grey, and points nothing names stay a quieter grey still.
 *
 * The popup is built from DOM nodes with textContent rather than an HTML string:
 * place names are typed by the user, and Leaflet renders a string popup as markup.
 */
const ChargingMap = ({ range, vehicleFilter, providerColors }) => {
  const theme = useTheme();
  const { user } = useAuth();
  const fmt = useMemo(() => createFormatters(user), [user]);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [data, setData] = useState(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [reload, setReload] = useState(0);

  const dark = theme.palette.mode === 'dark';
  // The rings paint their two greys translucent, which over map tiles all but
  // vanishes; on the map they are the solid greys of the same order.
  const otherColor = theme.palette.text.secondary;
  const unnamedColor = theme.palette.text.disabled;
  // The parent builds a fresh Map on every render; keyed by content, so the markers
  // are only redrawn when a colour actually changes.
  const colorKey = JSON.stringify([...(providerColors || new Map())]);
  const palette = useMemo(() => new Map(JSON.parse(colorKey)), [colorKey]);
  const styleFor = useCallback((point) => {
    if (!point.provider) return { color: unnamedColor, label: 'Unnamed', dashArray: '3 3' };
    const named = palette.get(point.provider);
    return named ? { color: named.color, label: named.name } : { color: otherColor, label: 'Other providers' };
  }, [palette, otherColor, unnamedColor]);

  useEffect(() => {
    let cancelled = false;
    const query = `range=${range}${vehicleFilter ? `&vehicles=${vehicleFilter}` : ''}`;
    apiFetch(`/api/analytics/map?${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [range, vehicleFilter, reload]);

  // The map itself is created once; points are redrawn into one layer group.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const animate = !reducedMotion();
    const map = L.map(containerRef.current, {
      zoomAnimation: animate,
      fadeAnimation: animate,
      markerZoomAnimation: animate,
      scrollWheelZoom: false,
    }).setView([47.5, 19.05], 6);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    // OpenStreetMap's credit is required; Leaflet's own is not, and on a phone the two
    // together wrapped onto a second line over the map.
    map.attributionControl.setPrefix(false);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const points = data?.points || [];
    if (!points.length) return;

    const maxVisits = Math.max(...points.map((point) => point.visits));
    points.forEach((point) => {
      const style = styleFor(point);
      const marker = L.circleMarker([point.latitude, point.longitude], {
        radius: radiusFor(point.visits, maxVisits),
        color: style.color,
        weight: 2,
        dashArray: style.dashArray,
        fillColor: style.color,
        fillOpacity: 0.4,
      });

      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = point.name || point.top_source || 'Unnamed spot';
      popup.appendChild(title);
      const lines = [
        point.provider && style.label !== title.textContent ? style.label : null,
        `${point.visits} record${point.visits === 1 ? '' : 's'}`,
        point.total_kwh ? fmt.energy(point.total_kwh) : null,
        point.total_liters ? fmt.volume(point.total_liters) : null,
        `${fmt.money(point.total_cost)} in total`,
        point.avg_cost_per_kwh != null ? `${fmt.money(point.avg_cost_per_kwh)} / kWh on average` : null,
        point.last_at ? `Last: ${new Date(point.last_at).toLocaleDateString()}` : null,
      ].filter(Boolean);
      lines.forEach((text) => {
        const line = document.createElement('div');
        line.textContent = text;
        popup.appendChild(line);
      });
      marker.bindPopup(popup);
      marker.addTo(layer);
    });
  }, [data, styleFor, fmt]);

  // Framed only when the data changes, so a recolour never throws away where the
  // reader had panned to.
  useEffect(() => {
    const map = mapRef.current;
    const points = data?.points || [];
    if (!map || !points.length) return;
    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14, animate: !reducedMotion() });
  }, [data]);

  const coverage = data?.coverage;
  const points = data?.points || [];
  // Only what the map actually shows, in the rings' order, then the two greys.
  const legend = useMemo(() => {
    const shown = new Map();
    (data?.points || []).forEach((point) => {
      const style = styleFor(point);
      shown.set(style.label, style);
    });
    const order = [...palette.values()].map((entry) => entry.name);
    return [...shown.values()].sort((a, b) => {
      const rank = (style) => {
        const index = order.indexOf(style.label);
        if (index >= 0) return index;
        return style.label === 'Other providers' ? order.length : order.length + 1;
      };
      return rank(a) - rank(b);
    });
  }, [data, styleFor, palette]);

  return (
    <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Where you charge</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every place with a location on its records, in the same colours as Providers.
        Bigger dots are used more often; tap one for what it cost.
      </Typography>

      <Box
        sx={{
          position: 'relative',
          height: MAP_HEIGHT,
          borderRadius: 3,
          overflow: 'hidden',
          border: 1,
          borderColor: 'divider',
          // Leaflet's own stacking reaches z-index 1000, which would sit over the app's
          // dialogs and menus. A new stacking context keeps all of it inside the card.
          isolation: 'isolate',
          '& .leaflet-tile-pane': dark ? { filter: DARK_TILE_FILTER } : {},
          '& .leaflet-container': { background: theme.palette.background.default, font: 'inherit' },
          '& .leaflet-control-attribution': { fontSize: 10 },
        }}
      >
        <Box ref={containerRef} sx={{ position: 'absolute', inset: 0 }} />
        {data && !points.length ? (
          <Stack
            alignItems="center" justifyContent="center"
            sx={{ position: 'absolute', inset: 0, zIndex: 1000, pointerEvents: 'none', p: 3, textAlign: 'center' }}
          >
            <Typography variant="body2" sx={{ bgcolor: 'background.paper', px: 2, py: 1, borderRadius: 2 }}>
              No record in this range has a location yet.
            </Typography>
          </Stack>
        ) : null}
      </Box>

      <Stack
        direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 2 }}
        justifyContent="space-between" sx={{ mt: 1.5, minHeight: 24 }}
      >
        <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
          {legend.map((style) => (
            <Stack key={style.label} direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: style.color }} />
              <Typography variant="caption" color="text.secondary">{style.label}</Typography>
            </Stack>
          ))}
        </Stack>
        {coverage && coverage.records > 0 ? (
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography variant="caption" color="text.secondary">
              {coverage.located === coverage.records
                ? `All ${coverage.records} records have a location.`
                : `${coverage.located} of ${coverage.records} records have a location.`}
            </Typography>
            {coverage.located < coverage.records ? (
              <Button size="small" onClick={() => setAssignOpen(true)}>Add places to older records</Button>
            ) : null}
          </Stack>
        ) : null}
      </Stack>

      <AssignPlacesDialog
        open={assignOpen}
        onClose={(changed) => {
          setAssignOpen(false);
          if (changed) setReload((count) => count + 1);
        }}
      />
    </Card>
  );
};

export default ChargingMap;
