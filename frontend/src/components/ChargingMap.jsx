import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Card, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { createFormatters } from '../utils/units';

// OpenStreetMap's own tiles, with the attribution their policy requires. Fine for an
// account's own map at this traffic; a public launch needs a tile provider with an
// agreement (MapTiler, Stadia) — swap the URL and attribution here.
const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const MAP_HEIGHT = { xs: 300, md: 380 };

const radiusFor = (visits, maxVisits) => 6 + 16 * Math.sqrt(visits / Math.max(maxVisits, 1));

const reducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Where the account charges and fuels, on a map: a dot per place, sized by how often
 * it is used and coloured by what a kWh costs there relative to the account's other
 * places. Covers the same range and vehicles as the rest of the Analytics page.
 *
 * The popup is built from DOM nodes with textContent rather than an HTML string:
 * place names are typed by the user, and Leaflet renders a string popup as markup.
 */
const ChargingMap = ({ range, vehicleFilter }) => {
  const theme = useTheme();
  const { user } = useAuth();
  const fmt = useMemo(() => createFormatters(user), [user]);
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [data, setData] = useState(null);

  const dark = theme.palette.mode === 'dark';
  const colors = useMemo(() => ({
    cheap: theme.palette.success.main,
    mid: theme.palette.warning.main,
    pricey: theme.palette.error.main,
    fuel: theme.palette.text.secondary,
  }), [theme]);

  useEffect(() => {
    let cancelled = false;
    const query = `range=${range}${vehicleFilter ? `&vehicles=${vehicleFilter}` : ''}`;
    apiFetch(`/api/analytics/map?${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => { if (!cancelled) setData(json); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [range, vehicleFilter]);

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

  // Cheap / middling / pricey by the account's own spread, not by fixed prices: what
  // counts as expensive is different in every country and every currency.
  const priceBand = useMemo(() => {
    const prices = (data?.points || [])
      .map((point) => point.avg_cost_per_kwh)
      .filter((value) => value != null)
      .sort((a, b) => a - b);
    if (prices.length < 3) return () => 'mid';
    const low = prices[Math.floor(prices.length / 3)];
    const high = prices[Math.floor((2 * prices.length) / 3)];
    return (value) => (value < low ? 'cheap' : value >= high ? 'pricey' : 'mid');
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const points = data?.points || [];
    if (!points.length) return;

    const maxVisits = Math.max(...points.map((point) => point.visits));
    points.forEach((point) => {
      const band = point.avg_cost_per_kwh == null ? 'fuel' : priceBand(point.avg_cost_per_kwh);
      const marker = L.circleMarker([point.latitude, point.longitude], {
        radius: radiusFor(point.visits, maxVisits),
        color: colors[band],
        weight: 2,
        fillColor: colors[band],
        fillOpacity: 0.35,
      });

      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = point.name || point.top_source || 'Unnamed spot';
      popup.appendChild(title);
      const lines = [
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

    const bounds = L.latLngBounds(points.map((point) => [point.latitude, point.longitude]));
    map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14, animate: !reducedMotion() });
  }, [data, colors, priceBand, fmt]);

  const coverage = data?.coverage;
  const points = data?.points || [];

  return (
    <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 0.5 }}>Where you charge</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Every place with a location on its records. Bigger dots are used more often; the
        colour is what a kWh costs there compared with your other places.
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
          // OpenStreetMap only draws light tiles; inverted, they sit in a dark page
          // instead of glaring out of it.
          '& .leaflet-tile-pane': dark ? { filter: 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)' } : {},
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
          {[['cheap', 'Cheaper / kWh'], ['mid', 'Middle'], ['pricey', 'Pricier / kWh'], ['fuel', 'Fuel only']].map(([key, label]) => (
            <Stack key={key} direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: colors[key] }} />
              <Typography variant="caption" color="text.secondary">{label}</Typography>
            </Stack>
          ))}
        </Stack>
        {coverage && coverage.records > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {coverage.located === coverage.records
              ? `All ${coverage.records} records have a location.`
              : `${coverage.located} of ${coverage.records} records have a location.`}
          </Typography>
        ) : null}
      </Stack>
    </Card>
  );
};

export default ChargingMap;
