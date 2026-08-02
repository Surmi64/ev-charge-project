import { getBrand } from './palette';

// Categorical series colors for Recharts.
//
// These must be picked per theme rather than shared: the dark-mode neons drop to
// 1.3:1 against the light surface, which makes cyan slices effectively invisible.
// Both sets are now the brand hues from utils/palette.js in a fixed order, so the
// first four series are literally primary, secondary, success and warning instead
// of a parallel set of near-identical literals, and a series keeps its identity
// when the user toggles the theme.
const SERIES_HUES = ['cyan', 'magenta', 'green', 'amber', 'violet'];

export const getChartColors = (theme) => {
  const brand = getBrand(theme);
  return SERIES_HUES.map((hue) => brand[hue]);
};

export const getSeriesColor = (theme, index) => {
  const series = getChartColors(theme);
  return series[index % series.length];
};
