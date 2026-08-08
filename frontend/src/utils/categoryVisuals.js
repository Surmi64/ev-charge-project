import { alpha } from '@mui/material/styles';

import { FUEL_ACCENT, HUES } from './palette';

// `color` is the hue used for borders and glows in both themes.
// `text` is the label colour, and it has to differ per theme: the light tints below
// were designed against a dark surface and land at ~1.1:1 on the near-white chip
// background in light mode. `textLight` keeps the same hue but is darkened until it
// clears 4.5:1 there.
export const CATEGORY_VISUALS = {
  charging: { color: HUES.dark.blue, text: '#D6E8FF', textLight: '#0B5FBF' },
  fueling: { color: FUEL_ACCENT.petrol, text: '#FFEBD1', textLight: '#A15C00' },
  maintenance: { color: HUES.dark.green, text: '#DCFBE6', textLight: '#137A48' },
  insurance: { color: '#7FC4E8', text: '#DFF2FF', textLight: '#0F6E9C' },
  parking: { color: '#C3B7E0', text: '#ECE6FA', textLight: '#5B4B99' },
  toll: { color: '#F08A6B', text: '#FFE0D6', textLight: '#B33C10' },
  tax: { color: HUES.dark.gold, text: '#FFF3C9', textLight: '#7E6100' },
  inspection: { color: '#7FD9C4', text: '#DDFBF2', textLight: '#0B7A62' },
  cleaning: { color: '#BCD97A', text: '#F1FBD6', textLight: '#4F7A0E' },
  other: { color: HUES.dark.silver, text: '#EEF3F7', textLight: '#516878' },
};

export function getCategoryVisual(category) {
  return CATEGORY_VISUALS[category] || CATEGORY_VISUALS.other;
}

export function getCategoryTextColor(theme, category) {
  const visual = getCategoryVisual(category);
  return theme.palette.mode === 'dark' ? visual.text : visual.textLight;
}

export function getCategoryChipSx(theme, category) {
  const visual = getCategoryVisual(category);

  return {
    color: getCategoryTextColor(theme, category),
    borderColor: alpha(visual.color, theme.palette.mode === 'dark' ? 0.42 : 0.55),
    backgroundColor: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.72 : 0.96),
    boxShadow: `0 0 12px ${alpha(visual.color, 0.12)}`,
  };
}

export function getCategoryBoxSx(theme, category, options = {}) {
  const visual = getCategoryVisual(category);
  const compact = options.compact ?? false;

  return {
    p: compact ? 1.5 : 2,
    borderRadius: compact ? 3 : 4,
    border: `1px solid ${alpha(visual.color, 0.76)}`,
    background: alpha(theme.palette.background.paper, theme.palette.mode === 'dark' ? 0.72 : 0.96),
    boxShadow: [
      `0 0 0 1px ${alpha(visual.color, 0.16)} inset`,
      `0 0 16px ${alpha(visual.color, 0.1)}`,
    ].join(', '),
  };
}
