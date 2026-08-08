import { getSeries } from './palette';

// Categorical series colors for Recharts.
//
// The set itself lives in utils/palette.js, per palette and per mode, and App.jsx
// stamps the resolved five onto the MUI theme. This file is only the lookup, kept
// separate because Analytics asks for colours by series index and should not have
// to know how a palette resolves.
//
// They must be picked per mode rather than shared: the dark values drop to around
// 1.3:1 against the light surface, which makes pale slices invisible. Both sets
// keep the same order, so a series does not change identity when the user toggles
// the theme.

export const getChartColors = (theme) => getSeries(theme);

export const getSeriesColor = (theme, index) => {
  const series = getSeries(theme);
  return series[index % series.length];
};
