import { alpha } from '@mui/material/styles';

export const CATEGORY_VISUALS = {
  charging: { color: '#00F5FF', text: '#CFFBFF' },
  fueling: { color: '#FFB547', text: '#FFF0CF' },
  maintenance: { color: '#87FF65', text: '#E2FFD9' },
  insurance: { color: '#6AC6FF', text: '#E0F4FF' },
  parking: { color: '#9F7BFF', text: '#E9E1FF' },
  toll: { color: '#FF8A5B', text: '#FFE2D7' },
  tax: { color: '#FFD447', text: '#FFF5C4' },
  inspection: { color: '#7CF2C9', text: '#DFFFF2' },
  cleaning: { color: '#C7F464', text: '#F4FFD0' },
  other: { color: '#B9C6D1', text: '#EEF3F7' },
};

export function getCategoryVisual(category) {
  return CATEGORY_VISUALS[category] || CATEGORY_VISUALS.other;
}

export function getCategoryChipSx(theme, category) {
  const visual = getCategoryVisual(category);

  return {
    color: visual.text,
    borderColor: alpha(visual.color, 0.42),
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