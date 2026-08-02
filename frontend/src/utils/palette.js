// The app's entire colour vocabulary, in one place.
//
// Five hues per theme carry everything: the MUI palette (primary, secondary,
// success, warning, error), the categorical chart series, and the accent hues in
// categoryVisuals and fuelVisuals. They were separate literals in five files and
// had already drifted -- the light body gradient still painted the pre-contrast
// brand values, and the light success green differed from the light chart green
// for no reason.
//
// The two sets keep the same hue order, so a series does not change identity when
// the user toggles the theme. Contrast is measured against the composited paper
// surface (#0B1116 dark, #FBFCFD light); every value below clears 4.5:1 as text
// there, which also covers the 3:1 floor for chart marks and borders.
// The dark hues were fully saturated (HSL S=100%) -- pure cyan, pure magenta, pure
// spring green. On a near-black surface that is glare rather than accent, and it
// left no headroom: everything was already at maximum, so nothing could stand out
// from anything else. They are the same hues at roughly half saturation now, which
// keeps the synthwave read (teal and orchid over near-black, gradient buttons,
// coloured glows) without the buzz.
export const BRAND = {
  dark: {
    cyan: '#5FC9D6',    //  9.8:1, S 59%
    magenta: '#D983C4', //  7.2:1, S 53%
    green: '#8FD98A',   // 11.3:1, S 51%
    amber: '#DFA85E',   //  9.0:1, S 67%
    violet: '#A98FE0',  //  7.0:1, S 57%
    red: '#DB8080',     //  6.7:1, S 56%
  },
  light: {
    cyan: '#0A6F80',    //  5.7:1
    magenta: '#A32F80', //  6.2:1
    green: '#1F6B41',   //  6.3:1
    amber: '#B45309',   //  4.9:1
    violet: '#6A2BA8',  //  8.1:1
    red: '#C62828',     //  5.5:1
  },
};

// Identity hue per fuel type. Kept out of BRAND because these are not theme
// variants of each other -- they are five distinct things a vehicle can be -- but
// kept here because both fuelVisuals and categoryVisuals key off them, and the
// `fueling` category is the petrol hue by definition rather than by coincidence.
// Electric borrows the brand green so a charging session reads as one colour
// across the chip, the card and the chart.
// Desaturated alongside BRAND, for the same reason.
export const FUEL_ACCENT = {
  electric: BRAND.dark.green,
  hybrid: '#7AB6DE',
  petrol: '#DFAE6B',
  diesel: '#C9A173',
  hydrogen: '#6CC9BE',
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
// above: the worst pairing is #F7FBFC on light amber at 4.8:1.
export const ON_BRAND = { dark: '#061015', light: '#F7FBFC' };

export const getBrand = (theme) => BRAND[theme.palette.mode];

export const getSurface = (theme) => SURFACE[theme.palette.mode];

export const getOnBrand = (theme) => ON_BRAND[theme.palette.mode];

// Offered as the default when a vehicle has no colour of its own. Dark-mode cyan
// rather than a mode-dependent value, because it is persisted per vehicle and has
// to mean the same thing after a theme toggle.
export const DEFAULT_VEHICLE_COLOR = BRAND.dark.cyan;
