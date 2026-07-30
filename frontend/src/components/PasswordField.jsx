import React, { useId, useState } from 'react';
import { Box, IconButton, InputAdornment, LinearProgress, TextField, Tooltip, Typography, useTheme } from '@mui/material';
import { CheckCircleOutline as MetIcon, RadioButtonUnchecked as UnmetIcon, Visibility, VisibilityOff } from '@mui/icons-material';
import { PASSWORD_RULES, passwordRuleState } from '../utils/passwordPolicy';

/**
 * Password input with a visibility toggle, and optionally the policy checklist.
 *
 * `showPolicy` is on where a password is being *chosen* (registration, reset) and off
 * where one is being *recalled* (sign in) — telling someone their existing password is
 * missing a digit while they type it is noise, and it leaks the rules to a shoulder
 * surfer for no benefit.
 *
 * The checklist is a live region so a screen reader hears rules being satisfied
 * instead of only discovering the problem on submit. Each rule carries an icon as well
 * as colour, so "met" does not depend on seeing green.
 */
const PasswordField = ({
  value,
  onChange,
  label = 'Password',
  autoComplete = 'current-password',
  showPolicy = false,
  error,
  helperText,
  onBlur,
  required = true,
  ...rest
}) => {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  const policyId = useId();

  const rules = showPolicy ? passwordRuleState(value) : [];
  const metCount = rules.filter((rule) => rule.met).length;
  const progress = (metCount / PASSWORD_RULES.length) * 100;

  return (
    <Box>
      <TextField
        {...rest}
        fullWidth
        required={required}
        label={label}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        error={Boolean(error)}
        helperText={error || helperText}
        autoComplete={autoComplete}
        aria-describedby={showPolicy ? policyId : undefined}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <Tooltip title={visible ? 'Hide password' : 'Show password'}>
                  <IconButton
                    onClick={() => setVisible((previous) => !previous)}
                    edge="end"
                    // The label announces the action, not the state, so it stays
                    // meaningful to a screen reader that cannot see the icon change.
                    aria-label={visible ? 'Hide password' : 'Show password'}
                    aria-pressed={visible}
                  >
                    {visible ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </InputAdornment>
            ),
          },
        }}
      />

      {showPolicy ? (
        <Box id={policyId} sx={{ mt: 1.25 }} aria-live="polite">
          <LinearProgress
            variant="determinate"
            value={progress}
            aria-hidden="true"
            sx={{
              height: 4,
              borderRadius: 2,
              mb: 1,
              bgcolor: theme.palette.action.hover,
              '& .MuiLinearProgress-bar': {
                borderRadius: 2,
                // Amber until every rule passes, so "partly there" never looks done.
                bgcolor: metCount === PASSWORD_RULES.length
                  ? theme.palette.success.main
                  : theme.palette.warning.main,
              },
            }}
          />
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 0.5 }}>
            {rules.map((rule) => (
              <Box key={rule.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {rule.met ? (
                  <MetIcon sx={{ fontSize: 15, color: 'success.main' }} />
                ) : (
                  <UnmetIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
                )}
                <Typography
                  variant="caption"
                  sx={{ color: rule.met ? 'text.secondary' : 'text.disabled', lineHeight: 1.4 }}
                >
                  {rule.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
};

export default PasswordField;
