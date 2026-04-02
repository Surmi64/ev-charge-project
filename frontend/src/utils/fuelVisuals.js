import { alpha } from '@mui/material/styles';

const FUEL_VISUALS = {
  electric: {
    primary: '#87FF65',
    secondary: '#2FFFA8',
    border: '#65C86B',
    text: '#D8FFD2',
  },
  hybrid: {
    primary: '#58C7FF',
    secondary: '#8A7DFF',
    border: '#58AFFF',
    text: '#DDF5FF',
  },
  petrol: {
    primary: '#FFB547',
    secondary: '#8B5A2B',
    border: '#C7922C',
    text: '#FFF0CF',
  },
  diesel: {
    primary: '#E4A64C',
    secondary: '#6F4F2F',
    border: '#B9832A',
    text: '#FBEACC',
  },
};

export function getFuelVisual(fuelType) {
  return FUEL_VISUALS[fuelType] || FUEL_VISUALS.petrol;
}

export function getFuelChipSx(theme, fuelType) {
  const visual = getFuelVisual(fuelType);

  return {
    color: visual.text,
    borderColor: alpha(visual.border, 0.78),
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
    background: borderOnly
      ? alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.72 : 0.94)
      : [
          `radial-gradient(circle at 10% 0%, ${alpha(visual.primary, 0.18)}, transparent 42%)`,
          `radial-gradient(circle at 100% 100%, ${alpha(visual.secondary, 0.16)}, transparent 36%)`,
          `linear-gradient(135deg, ${alpha('#1A1308', theme.palette.mode === 'dark' ? 0.9 : 0.2)}, ${alpha('#120F0A', theme.palette.mode === 'dark' ? 0.72 : 0.08)})`,
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