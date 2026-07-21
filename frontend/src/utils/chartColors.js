// Categorical series colors for Recharts.
//
// These must be picked per theme rather than shared: the dark-mode neons drop to
// 1.3:1 against the light surface, which makes cyan slices effectively invisible.
// Every value below clears the 3:1 contrast floor for non-text data against its
// own theme's surface, and the two sets keep the same hue order so a series does
// not change identity when the user toggles the theme.

const DARK_SERIES = [
  '#00F5FF', // cyan     14.0:1
  '#FF00E5', // magenta   5.8:1
  '#32CD32', // green     9.0:1
  '#FFA500', // amber     9.6:1
  '#B47CFF', // violet    6.6:1
];

const LIGHT_SERIES = [
  '#0A6F80', // teal      5.7:1
  '#A32F80', // magenta   6.3:1
  '#1F6B41', // green     6.3:1
  '#B45309', // amber     4.9:1
  '#6A2BA8', // violet    8.1:1
];

export const getChartColors = (theme) =>
  theme.palette.mode === 'dark' ? DARK_SERIES : LIGHT_SERIES;

export const getSeriesColor = (theme, index) => {
  const series = getChartColors(theme);
  return series[index % series.length];
};
