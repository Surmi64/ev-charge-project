/**
 * The colour set the exported PDF is drawn with.
 *
 * The report used to be printed by the browser, so it was locked to the light hues
 * whatever the app was set to — dark ink on white paper is what a printer wants, and
 * a dark card would have cost the reader a cartridge. The PDF is generated now and is
 * read on a screen, so it follows the account instead: the same palette, the same
 * mode, the same washed background the page itself carries.
 *
 * Everything here derives from utils/palette.js. Nothing in this file invents a hex
 * that is not either a measured hue or a blend of two of them, so a report stays
 * inside the contrast set the palette was measured against.
 */
import {
  DEFAULT_PALETTE,
  ON_BRAND,
  SURFACE,
  isPaletteId,
  resolveBrand,
  resolveSeries,
} from './palette';

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

const toRgb = (hex) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

/** `weight` is how much of `other` ends up in the result, as CSS color-mix would. */
export const mixHex = (hex, other, weight) => {
  const a = toRgb(hex);
  const b = toRgb(other);
  const out = a.map((channel, i) => clamp255(channel + (b[i] - channel) * weight));
  return `#${out.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

export const withAlpha = (hex, alpha) => {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * Every colour the report and the page painter need, for one palette in one mode.
 *
 * `cardSolid` is the one value that is a blend rather than a surface: the report's
 * cards are translucent over the wash on screen, but a pie slice divider and the
 * hatch behind a projected bar have to be opaque or the wash shows through the chart
 * and reads as a stray mark. It is what the card composites to over its own page.
 */
export function buildReportTheme(paletteId, mode) {
  const m = mode === 'light' ? 'light' : 'dark';
  const id = isPaletteId(paletteId) ? paletteId : DEFAULT_PALETTE;
  const surface = SURFACE[m];
  const brand = resolveBrand(id, m);
  const ink = surface.textPrimary;
  const cardSolid = m === 'dark'
    ? mixHex(surface.background, '#FFFFFF', 0.07)
    : mixHex(surface.background, '#FFFFFF', 0.86);

  return {
    mode: m,
    brand,
    series: resolveSeries(id, m),
    background: surface.background,
    cardSolid,
    // The card itself stays translucent so the wash carries through it, exactly as
    // Paper does on screen.
    card: m === 'dark' ? withAlpha('#FFFFFF', 0.045) : withAlpha('#FFFFFF', 0.72),
    cardBorder: withAlpha(ink, m === 'dark' ? 0.12 : 0.1),
    ink,
    inkMuted: withAlpha(ink, m === 'dark' ? 0.68 : 0.74),
    inkFaint: withAlpha(ink, m === 'dark' ? 0.46 : 0.52),
    rule: withAlpha(ink, m === 'dark' ? 0.26 : 0.24),
    ruleSoft: withAlpha(ink, m === 'dark' ? 0.12 : 0.1),
    grid: m === 'dark' ? withAlpha('#FFFFFF', 0.05) : withAlpha(ink, 0.06),
    // Label ink on a filled bar. Measured against every hue in its own mode.
    onFill: ON_BRAND[m],
    // The tail and unnamed buckets in the provider rings — the same two greys the
    // screen uses, derived the same way.
    tail: withAlpha(ink, m === 'dark' ? 0.32 : 0.28),
    unnamed: withAlpha(ink, m === 'dark' ? 0.16 : 0.14),
  };
}

/** The inline custom properties the report's stylesheet reads. */
export function reportCssVars(theme) {
  return {
    '--pr-ink': theme.ink,
    '--pr-muted': theme.inkMuted,
    '--pr-faint': theme.inkFaint,
    '--pr-rule': theme.rule,
    '--pr-rule-soft': theme.ruleSoft,
    '--pr-card': theme.card,
    '--pr-card-border': theme.cardBorder,
    '--pr-accent': theme.brand.primary,
  };
}
