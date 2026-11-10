import React from 'react';
import { Box, MenuItem, Select, Typography } from '@mui/material';
import { useAuth } from '../context/useAuth';
import { FLEET_ROLES } from '../utils/fleet';

const OWN = 'own';

/**
 * Which account's records this tab works on: the person's own, or a fleet they are in.
 *
 * Drawn only once there is a choice. The current fleet stays visible as the select's
 * value, so someone recording a charge can always see whose car it is going on.
 */
const WorkspaceSwitcher = ({ dense = false }) => {
  const { workspace, switchWorkspace } = useAuth();
  if (!workspace?.fleets?.length) return null;

  const value = workspace.is_own ? OWN : String(workspace.tenant_id);

  return (
    <Box sx={{ minWidth: 0 }}>
      {dense ? null : <Typography className="industrial-kicker" sx={{ px: 1.2, pb: 0.75 }}>Working in</Typography>}
      <Select
        size="small" fullWidth value={value} aria-label="Working in"
        onChange={(event) => switchWorkspace(event.target.value === OWN ? null : Number(event.target.value))}
        renderValue={(selected) => {
          if (selected === OWN) return 'My account';
          const fleet = workspace.fleets.find((item) => String(item.owner_id) === selected);
          return fleet ? `${fleet.owner_name} · ${FLEET_ROLES[fleet.role]?.label}` : 'Fleet';
        }}
        sx={workspace.is_own ? undefined : { bgcolor: 'action.selected', fontWeight: 600 }}
      >
        <MenuItem value={OWN}>My account</MenuItem>
        {workspace.fleets.map((fleet) => (
          <MenuItem key={fleet.owner_id} value={String(fleet.owner_id)}>
            {fleet.owner_name}
            <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
              {FLEET_ROLES[fleet.role]?.label}
            </Typography>
          </MenuItem>
        ))}
      </Select>
    </Box>
  );
};

export default WorkspaceSwitcher;
