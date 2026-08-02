import { alpha } from '@mui/material/styles';

import { FUEL_ACCENT } from './palette';

// `primary` is the identity hue from utils/palette.js; `secondary` and `border` are
// the shading around it. `text` is tuned for dark surfaces (~10:1 there) but drops
// to ~1.0:1 on the light tinted chip background, so `textLight` carries a darkened
// version of the same hue.
const FUEL_VISUALS = {
  electric: {
    primary: FUEL_ACCENT.electric,
    secondary: '#6FD9A8',
    border: '#79BE7F',
    text: '#DCFBE6',
    textLight: '#0F7346',
  },
  hybrid: {
    primary: FUEL_ACCENT.hybrid,
    // A hybrid is two drivetrains, so the wash runs from its own blue into the
    // electric green rather than into the violet it used to carry.
    secondary: '#7FD1A4',
    border: '#7AB4E0',
    text: '#DDF0FF',
    textLight: '#0F6E9C',
  },
  petrol: {
    primary: FUEL_ACCENT.petrol,
    secondary: '#8B5A2B',
    border: '#BE9A5B',
    text: '#FFEBD1',
    textLight: '#A15C00',
  },
  diesel: {
    primary: FUEL_ACCENT.diesel,
    secondary: '#6F4F2F',
    border: '#B08D5E',
    text: '#FBEACC',
    textLight: '#915E16',
  },
  hydrogen: {
    // Chrome rather than the old teal, which read as a second charging cyan.
    primary: FUEL_ACCENT.hydrogen,
    secondary: '#8FA8BF',
    border: '#A8BDD1',
    text: '#EDF3F9',
    textLight: '#516878',
  },
};

export function getFuelVisual(fuelType) {
  return FUEL_VISUALS[fuelType] || FUEL_VISUALS.petrol;
}

export function getFuelChipSx(theme, fuelType) {
  const visual = getFuelVisual(fuelType);

  return {
    color: theme.palette.mode === 'dark' ? visual.text : visual.textLight,
    borderColor: alpha(visual.border, theme.palette.mode === 'dark' ? 0.78 : 0.9),
    background: `linear-gradient(135deg, ${alpha(visual.primary, 0.22)}, ${alpha(visual.secondary, 0.14)})`,
    boxShadow: `0 0 12px ${alpha(visual.border, 0.18)}`,
    '& .MuiChip-icon': {
      color: visual.primary,
    },
  };
}

export function getFuelBoxSx(theme, fuelType, options = {}) {
  const visual = getFuelVisual(fuelType);
  const compact = options.compact ?? false;
  const borderOnly = options.borderOnly ?? false;

  return {
    p: compact ? 1.5 : 2,
    borderRadius: compact ? 3 : 4,
    border: `1px solid ${alpha(visual.border, 0.9)}`,
    // The base under the two accent washes used to be a pair of browns (#1A1308 /
    // #120F0A) left over from a petrol-only design, so an electric or hydrogen card
    // sat on a warm tint that fought its own hue. It is the app surface now, and the
    // fuel identity comes only from the accents on top.
    background: borderOnly
      ? alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.72 : 0.94)
      : [
          `radial-gradient(circle at 10% 0%, ${alpha(visual.primary, 0.18)}, transparent 42%)`,
          `radial-gradient(circle at 100% 100%, ${alpha(visual.secondary, 0.16)}, transparent 36%)`,
          `linear-gradient(135deg, ${alpha(theme.palette.background.default, theme.palette.mode === 'dark' ? 0.9 : 0.2)}, ${alpha(theme.palette.background.default, theme.palette.mode === 'dark' ? 0.72 : 0.08)})`,
        ].join(','),
    boxShadow: [
      `0 0 0 1px ${alpha(visual.border, 0.2)} inset`,
      `0 0 18px ${alpha(visual.border, 0.16)}`,
      `0 0 30px ${alpha(visual.primary, 0.1)}`,
    ].join(', '),
  };
}

export function getSessionCardSx(theme, fuelType) {
  const visual = getFuelVisual(fuelType);

  return {
    p: 2,
    borderRadius: 3,
    position: 'relative',
    overflow: 'hidden',
    border: `1px solid ${alpha(visual.border, 0.72)}`,
    background: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.74 : 0.96),
    boxShadow: `0 0 18px ${alpha(visual.border, 0.14)}`,
  };
}