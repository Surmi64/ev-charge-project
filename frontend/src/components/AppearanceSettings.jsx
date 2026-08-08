import React, { useState } from 'react';
import {
  Box,
  Chip,
  Paper,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Check as CheckIcon } from '@mui/icons-material';
import { toast } from 'sonner';

import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import {
  DEFAULT_PALETTE,
  PALETTES,
  PALETTE_IDS,
  getPaletteSwatches,
  isPaletteId,
} from '../utils/palette';

/**
 * Which palette the account sees.
 *
 * Applied on click rather than behind a Save button, unlike the other settings
 * cards: this one is a look, the whole page repaints as the answer, and a preview
 * swatch is a worse version of the thing itself. The PATCH is fired in the
 * background and the selection rolls back if it fails, so the state on screen and
 * the state on the server cannot drift apart silently.
 *
 * The swatches are drawn for the mode currently in use. A palette carries both a
 * light and a dark set and the two are chosen independently, so showing the dark
 * hues to someone reading in light mode would be advertising the wrong colours.
 */
const AppearanceSettings = () => {
  const { user, updateUser } = useAuth();
  const theme = useTheme();
  const mode = theme.palette.mode;
  const [saving, setSaving] = useState(false);

  const selected = isPaletteId(user?.theme_palette) ? user.theme_palette : DEFAULT_PALETTE;

  const handleSelect = async (paletteId) => {
    if (paletteId === selected || saving) return;
    const previous = selected;

    setSaving(true);
    updateUser({ theme_palette: paletteId });
    try {
      const res = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ theme_palette: paletteId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.detail || 'Could not save your palette');
      }
      toast.success(`${PALETTES[paletteId].name} applied`);
    } catch (error) {
      updateUser({ theme_palette: previous });
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
      <Typography variant="h6" gutterBottom>Appearance</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        The colours the app is built from. Each palette ships a light and a dark set —
        this picks the hues, the sidebar switch still picks the mode.
      </Typography>

      <Stack spacing={1.5}>
        {PALETTE_IDS.map((id) => {
          const palette = PALETTES[id];
          const swatches = getPaletteSwatches(id, mode);
          const isSelected = id === selected;

          return (
            <Box
              key={id}
              component="button"
              type="button"
              onClick={() => handleSelect(id)}
              disabled={saving}
              aria-pressed={isSelected}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                width: '100%',
                textAlign: 'left',
                font: 'inherit',
                color: 'inherit',
                cursor: saving ? 'progress' : 'pointer',
                p: 1.75,
                borderRadius: 3,
                border: '1px solid',
                borderColor: isSelected ? alpha(swatches[0], 0.72) : 'divider',
                // The selected card carries the palette's own glow, so the answer to
                // "which one is on" is the same colour as the thing it turned on.
                bgcolor: isSelected ? alpha(swatches[0], mode === 'dark' ? 0.1 : 0.08) : 'transparent',
                boxShadow: isSelected ? `0 0 14px ${alpha(swatches[0], 0.16)}` : 'none',
                '&:hover': {
                  borderColor: alpha(swatches[0], 0.5),
                  bgcolor: alpha(swatches[0], mode === 'dark' ? 0.07 : 0.05),
                },
                '&:disabled': { cursor: 'wait' },
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  display: 'flex',
                  flexShrink: 0,
                  borderRadius: 2,
                  overflow: 'hidden',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                {swatches.map((hex) => (
                  <Box key={hex} sx={{ width: 22, height: 44, bgcolor: hex }} />
                ))}
              </Box>

              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {palette.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {palette.description}
                </Typography>
              </Box>

              {isSelected ? (
                <Chip
                  size="small"
                  icon={<CheckIcon />}
                  label="In use"
                  sx={{
                    flexShrink: 0,
                    color: swatches[0],
                    borderColor: alpha(swatches[0], 0.5),
                    '& .MuiChip-icon': { color: swatches[0] },
                  }}
                  variant="outlined"
                />
              ) : null}
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
};

export default AppearanceSettings;
