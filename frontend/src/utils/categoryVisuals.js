import { alpha } from '@mui/material/styles';

// `color` is the hue used for borders and glows in both themes.
// `text` is the label colour, and it has to differ per theme: the light tints below
// were designed against a dark surface and land at ~1.1:1 on the near-white chip
// background in light mode. `textLight` keeps the same hue but is darkened until it
// clears 4.5:1 there.
export const CATEGORY_VISUALS = {
  charging: { color: '#00F5FF', text: '#CFFBFF', textLight: '#007F85' },
  fueling: { color: '#FFB547', text: '#FFF0CF', textLight: '#A86400' },
  maintenance: { color: '#87FF65', text: '#E2FFD9', textLight: '#1E8900' },
  insurance: { color: '#6AC6FF', text: '#E0F4FF', textLight: '#007AC6' },
  parking: { color: '#9F7BFF', text: '#E9E1FF', textLight: '#8152FF' },
  toll: { color: '#FF8A5B', text: '#FFE2D7', textLight: '#D53D00' },
  tax: { color: '#FFD447', text: '#FFF5C4', textLight: '#937100' },
  inspection: { color: '#7CF2C9', text: '#DFFFF2', textLight: '#0D855C' },
  cleaning: { color: '#C7F464', text: '#F4FFD0', textLight: '#597E09' },
  other: { color: '#B9C6D1', text: '#EEF3F7', textLight: '#5E788E' },
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
