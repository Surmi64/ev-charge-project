import React, { useMemo } from 'react';
import { Box, useMediaQuery } from '@mui/material';
import { alpha, keyframes, useTheme } from '@mui/material/styles';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// How many characters roll past before a drum settles. Enough to read as movement,
// short enough that the whole word has landed in well under a second and a half.
const REEL_LENGTH = 7;

// Sized so ten drums sit inside the sidebar header's 228px of inner width
// (308 - 2×20 outer padding - 2×20 card padding) with margin to spare rather than
// filling it edge to edge. The auth screen has room and passes a larger scale.
const BASE_CELL_WIDTH = 18;
const BASE_CELL_HEIGHT = 32;
const BASE_FONT_SIZE = 21;

// Expressed as a share of the strip rather than a pixel offset, so one keyframes rule
// serves every scale: the strip is REEL_LENGTH cells tall, so moving it by
// (REEL_LENGTH-1)/REEL_LENGTH lands the last cell in the window whatever a cell measures.
const RESTING_PERCENT = ((REEL_LENGTH - 1) / REEL_LENGTH) * 100;
const RESTING_TRANSFORM = `translateY(-${RESTING_PERCENT}%)`;

const roll = keyframes`
  from { transform: translateY(0); }
  to { transform: ${RESTING_TRANSFORM}; }
`;

// The wordmark, split so the suffix can be coloured independently. The separator sits
// in the unaccented segment: it is a joint, not part of the OS.
const DEFAULT_SEGMENTS = [
  { text: 'MILEAGE-' },
  { text: 'OS', accent: true },
];

// Characters that scroll past a drum, ending on the one it must show. Walks backwards
// through the alphabet so the drum appears to count up into place. A character outside
// the alphabet — the separator — is treated as sitting just past Z, so its drum rolls
// through real letters like every other one instead of standing still.
const reelFor = (character) => {
  const source = ALPHABET.includes(character) ? ALPHABET : `${ALPHABET}${character}`;
  const end = source.indexOf(character);
  return Array.from({ length: REEL_LENGTH }, (_, index) => {
    const offset = REEL_LENGTH - 1 - index;
    return source[(end - offset + source.length * 2) % source.length];
  });
};

/**
 * The wordmark as a car odometer: one drum per character, each rolling up to its
 * resting glyph on mount.
 *
 * The drums are decoration — the strip carries a single aria-label so a screen reader
 * says the name once rather than spelling it out ten times.
 *
 * Reduced motion is handled here rather than left to the blanket rule in index.css.
 * That rule collapses animation-duration but not animation-delay, so the staggered
 * drums would sit on the wrong characters for a beat and then snap — a spelling
 * mistake rather than an animation. When motion is off the drums render at rest.
 */
const OdometerWordmark = ({ segments = DEFAULT_SEGMENTS, scale = 1 }) => {
  const theme = useTheme();
  const animate = !useMediaQuery('(prefers-reduced-motion: reduce)');
  const isDark = theme.palette.mode === 'dark';

  const cellWidth = Math.round(BASE_CELL_WIDTH * scale);
  const cellHeight = Math.round(BASE_CELL_HEIGHT * scale);
  const fontSize = Math.round(BASE_FONT_SIZE * scale);

  const characters = useMemo(
    () => segments.flatMap(({ text, accent }) =>
      text.toUpperCase().split('').map((character) => ({ character, accent: Boolean(accent) }))),
    [segments],
  );
  const label = useMemo(() => segments.map(({ text }) => text).join(''), [segments]);

  // Two palettes rather than one with opacity: a real odometer inverts between a lit
  // and an unlit dash, and each needs to clear 4.5:1 on its own. Measured against the
  // mid-drum tone, where the face is brightest and contrast is at its worst —
  // dark:  #f2f6f8 on #2b333a is 10.9:1, accent #ff8080 on #2b333a is 5.3:1.
  // light: #14181c on #fbfcfd is 16.4:1, accent #c62828 on #fbfcfd is 5.5:1.
  const drumFace = isDark
    ? 'linear-gradient(180deg, #05070a 0%, #131a20 16%, #2b333a 50%, #131a20 84%, #05070a 100%)'
    : 'linear-gradient(180deg, #b9bfc7 0%, #e6eaee 16%, #fbfcfd 50%, #e6eaee 84%, #b9bfc7 100%)';
  const glyphColor = isDark ? '#f2f6f8' : '#14181c';
  const accentColor = isDark ? '#ff8080' : '#c62828';

  return (
    <Box
      role="img"
      aria-label={label}
      sx={{
        display: 'inline-flex',
        gap: '2px',
        p: '3px',
        borderRadius: 1.5,
        // The housing the drums are recessed into.
        bgcolor: isDark ? '#04060a' : '#8f97a1',
        border: '1px solid',
        borderColor: isDark ? alpha(theme.palette.primary.main, 0.34) : alpha('#5c646e', 0.6),
        boxShadow: isDark
          ? `inset 0 2px 6px rgba(0,0,0,0.9), 0 0 12px ${alpha(theme.palette.primary.main, 0.22)}`
          : 'inset 0 2px 5px rgba(0,0,0,0.35)',
      }}
    >
      {characters.map(({ character, accent }, index) => (
        <Box
          key={`${character}-${index}`}
          aria-hidden="true"
          sx={{
            position: 'relative',
            width: cellWidth,
            height: cellHeight,
            overflow: 'hidden',
            borderRadius: '3px',
            background: drumFace,
            // The curvature: the face falls away at the top and bottom edges.
            '&::after': {
              content: '""',
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: isDark
                ? 'linear-gradient(180deg, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 34%, rgba(255,255,255,0.07) 50%, rgba(0,0,0,0) 66%, rgba(0,0,0,0.72) 100%)'
                : 'linear-gradient(180deg, rgba(0,0,0,0.30) 0%, rgba(0,0,0,0) 34%, rgba(255,255,255,0.55) 50%, rgba(0,0,0,0) 66%, rgba(0,0,0,0.30) 100%)',
            },
          }}
        >
          <Box
            sx={
              animate
                ? {
                    // `both` so the drum holds the first character of its reel through
                    // the delay; the word spinning up out of nonsense is the effect.
                    // Staggered like a real odometer, where the rightmost drum drives
                    // the ones to its left, so the last character settles first.
                    animation: `${roll} 900ms cubic-bezier(0.22, 0.9, 0.24, 1) both`,
                    animationDelay: `${(characters.length - 1 - index) * 55}ms`,
                  }
                : { transform: RESTING_TRANSFORM }
            }
          >
            {reelFor(character).map((glyph, glyphIndex) => (
              <Box
                key={glyphIndex}
                sx={{
                  height: cellHeight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: '"Rajdhani", "Roboto Condensed", "Arial Narrow", system-ui, sans-serif',
                  fontWeight: 700,
                  fontSize,
                  lineHeight: 1,
                  // Only the resting glyph is accented. Colouring the whole reel would
                  // tint the letters rolling past, which reads as a bug mid-spin.
                  color: accent && glyphIndex === REEL_LENGTH - 1 ? accentColor : glyphColor,
                  textShadow: isDark ? '0 1px 2px rgba(0,0,0,0.85)' : '0 1px 0 rgba(255,255,255,0.65)',
                }}
              >
                {glyph}
              </Box>
            ))}
          </Box>
        </Box>
      ))}
    </Box>
  );
};

export default OdometerWordmark;
