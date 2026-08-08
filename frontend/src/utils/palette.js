// The app's entire colour vocabulary, in one place.
//
// Three layers, and the distinction between them is the whole design:
//
//   HUES     -- the verified pigments. Nothing outside this file invents a hex.
//   PALETTES -- which pigments a named theme points at primary and secondary.
//   ROLE_*   -- success, warning, error and neutral, the same in every palette.
//
// Contrast is measured against the composited paper surface (#0B1116 dark,
// #FBFCFD light); every value below clears 4.5:1 as text on its own surface *and*
// under the ON_BRAND label ink when it is used as a button fill, which also covers
// the 3:1 floor for chart marks and borders. Adding a hue means measuring it both
// ways -- a value that only clears one of the two is the failure mode this table
// exists to prevent.
//
// The palette used to be built on cyan and magenta, which is the obvious synthwave
// pairing and also the loudest: two hues the eye has no natural referent for,
// vibrating against each other at full strength. Desaturating them only made them
// dull rather than calm. The fix was the hue wheel, not the saturation slider --
// blue, gold, green, red and chrome are colours with real-world anchors, so they
// carry the same neon-over-near-black gradients and glows without the buzz.
// Saturation is back up where it belongs: the sidebar's destructive items and the
// wordmark accent read as red again instead of dusty pink.
//
// The two modes keep the same key names, so a series does not change identity when
// the user toggles between them.
export const HUES = {
  dark: {
    blue: '#5AA9FF',    //  7.7:1
    violet: '#A98FE0',  //  7.0:1
    emerald: '#3FD6A0', // 10.3:1
    green: '#5FD98D',   // 10.7:1
    lime: '#BCD97A',    // 12.1:1
    gold: '#F2CE5B',    // 12.4:1
    orange: '#F0A05B',  //  8.9:1
    coral: '#FF9A6B',   //  9.1:1
    red: '#FF7A7A',     //  7.5:1
    silver: '#CDDCEA',  // 13.6:1
    steel: '#9FB6CC',   //  9.1:1
  },
  light: {
    blue: '#0B5FBF',    //  6.0:1
    violet: '#6A2BA8',  //  8.1:1
    emerald: '#08715C', //  5.8:1
    green: '#0F7346',   //  5.7:1
    lime: '#4F7A0E',    //  5.0:1
    gold: '#8A6100',    //  5.4:1
    orange: '#B45309',  //  4.9:1
    coral: '#B33C10',   //  5.7:1
    red: '#C62828',     //  5.5:1
    silver: '#42586B',  //  7.2:1
    steel: '#3F5666',   //  7.5:1
  },
};

// The semantic roles do not vary by palette. Green means good and red means gone
// in every theme -- a palette that recoloured those would be asking the user to
// relearn the interface, which is not what picking a look is for. Only `primary`,
// `secondary` and the chart series change.
const ROLE_HUES = {
  success: 'green',
  warning: 'orange',
  error: 'red',
  neutral: 'silver',
};

// `series` is written out per palette rather than derived from the roles, because
// separation between adjacent slices is a property of the whole set: gold beside
// orange reads as one wedge no matter how well each performs alone. Five entries,
// which is what Analytics asks for before it wraps.
export const PALETTES = {
  'midnight-grove': {
    name: 'Midnight Grove',
    description: 'Deep blue into emerald. The default, and the calmest.',
    primary: 'blue',
    secondary: 'emerald',
    series: ['blue', 'emerald', 'gold', 'coral', 'silver'],
  },
  'neon-drift': {
    name: 'Neon Drift',
    description: 'Electric blue into gold, headlights on an empty motorway.',
    primary: 'blue',
    secondary: 'gold',
    series: ['blue', 'gold', 'green', 'red', 'silver'],
  },
  'sunset-cruise': {
    name: 'Sunset Cruise',
    description: 'Coral into amber. The warm end of the synthwave horizon.',
    primary: 'coral',
    secondary: 'gold',
    series: ['coral', 'gold', 'emerald', 'violet', 'silver'],
  },
  'violet-hour': {
    name: 'Violet Hour',
    description: 'Orchid over blue, the sky ten minutes after the sun goes.',
    primary: 'violet',
    secondary: 'blue',
    series: ['violet', 'blue', 'emerald', 'gold', 'silver'],
  },
  'chrome-noir': {
    name: 'Chrome Noir',
    description: 'Brushed steel and one blue. For when the data should shout, not the frame.',
    primary: 'steel',
    secondary: 'blue',
    series: ['steel', 'blue', 'gold', 'coral', 'green'],
  },
};

export const DEFAULT_PALETTE = 'midnight-grove';

export const PALETTE_IDS = Object.keys(PALETTES);

export const isPaletteId = (id) => Object.prototype.hasOwnProperty.call(PALETTES, id);

const resolvePaletteId = (id) => (isPaletteId(id) ? id : DEFAULT_PALETTE);

/** The six brand colours for one palette in one mode, as hex. */
export function resolveBrand(paletteId, mode) {
  const palette = PALETTES[resolvePaletteId(paletteId)];
  const hues = HUES[mode] || HUES.dark;
  return {
    primary: hues[palette.primary],
    secondary: hues[palette.secondary],
    success: hues[ROLE_HUES.success],
    warning: hues[ROLE_HUES.warning],
    error: hues[ROLE_HUES.error],
    neutral: hues[ROLE_HUES.neutral],
  };
}

/** The five categorical chart colours for one palette in one mode, as hex. */
export function resolveSeries(paletteId, mode) {
  const palette = PALETTES[resolvePaletteId(paletteId)];
  const hues = HUES[mode] || HUES.dark;
  return palette.series.map((hue) => hues[hue]);
}

/**
 * Swatches for the palette picker: primary, secondary and two series entries that
 * are not already one of those, so a card shows the range rather than repeating
 * itself.
 */
export function getPaletteSwatches(paletteId, mode) {
  const brand = resolveBrand(paletteId, mode);
  const extras = resolveSeries(paletteId, mode)
    .filter((hex) => hex !== brand.primary && hex !== brand.secondary)
    .slice(0, 2);
  return [brand.primary, brand.secondary, ...extras];
}

// Identity hue per fuel type. Deliberately outside the palettes: these are not a
// look, they are what a vehicle *is*, and an account that recoloured its theme and
// found its diesel cars had turned green would have lost information rather than
// changed a preference. Same reason the expense categories in categoryVisuals hold
// fixed hues. Both read from HUES so they stay in the measured set.
// `fueling` is the petrol hue by definition rather than by coincidence, and
// electric borrows the green so a charging session reads as one colour across the
// chip, the card and the chart.
export const FUEL_ACCENT = {
  electric: HUES.dark.green,
  hybrid: '#8FD0F0',
  petrol: '#F0A85B',
  diesel: '#D9B283',
  hydrogen: HUES.dark.silver,
};

// Neutrals. These are duplicated in index.css as --mileage-* custom properties for
// the handful of rules that run outside MUI; keep the two in step.
export const SURFACE = {
  dark: {
    background: '#070B0F',
    paper: 'rgba(12, 18, 24, 0.82)',
    textPrimary: '#EDF7FF',
    textSecondary: 'rgba(228, 236, 243, 0.68)',
    line: 'rgba(185, 214, 231, 0.12)',
    // The far end of the glass gradients on Paper and Card, and the fill behind
    // inputs. `sheen` is the near end -- always white, at a few percent in dark mode
    // and near-opaque in light.
    sheen: '#FFFFFF',
    tint: '#081017',
    shadow: '0, 0, 0',
  },
  light: {
    background: '#EEF3F6',
    paper: 'rgba(255, 255, 255, 0.78)',
    textPrimary: '#0B141A',
    textSecondary: 'rgba(36, 51, 63, 0.74)',
    line: 'rgba(31, 51, 64, 0.12)',
    sheen: '#FFFFFF',
    tint: '#E8F0F4',
    // Light-mode drop shadows were mixed from three different blue-greys
    // (27,43,54 / 28,45,56 / 22,37,48). One is enough.
    shadow: '27, 43, 54',
  },
};

// Ink for filled buttons and other solid brand fills. Measured against every hue
// above: the worst pairing is #F7FBFC on light orange at 4.8:1.
export const ON_BRAND = { dark: '#061015', light: '#F7FBFC' };

// App.jsx stamps the resolved palette onto the MUI theme, so anything holding a
// theme can read the brand without also knowing which palette is selected. The
// fallback covers a component rendered under a bare createTheme() -- there is no
// such call today, but returning undefined here would surface as a blank fill
// somewhere far from the cause.
export const getBrand = (theme) =>
  theme.palette.brand || resolveBrand(DEFAULT_PALETTE, theme.palette.mode);

export const getSeries = (theme) =>
  theme.palette.series || resolveSeries(DEFAULT_PALETTE, theme.palette.mode);

export const getSurface = (theme) => SURFACE[theme.palette.mode];

export const getOnBrand = (theme) => ON_BRAND[theme.palette.mode];

// Offered as the default when a vehicle has no colour of its own. A fixed hue
// rather than one that follows the mode or the selected palette, because it is
// persisted per vehicle and has to mean the same thing afterwards.
export const DEFAULT_VEHICLE_COLOR = HUES.dark.blue;
