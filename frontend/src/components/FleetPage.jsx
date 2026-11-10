import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Chip, CircularProgress, Divider, FormControl, IconButton, InputLabel, MenuItem, OutlinedInput,
  Paper, Select, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import {
  ContentCopy as CopyIcon, DeleteOutline as RemoveIcon, Refresh as RenewIcon,
} from '@mui/icons-material';
import { toast } from 'sonner';
import { apiFetch } from '../utils/api';
import { useAuth } from '../context/useAuth';
import { FLEET_ROLES } from '../utils/fleet';

const readError = async (res, fallback) => {
  const data = await res.json().catch(() => null);
  return data?.detail || fallback;
};

const request = async (path, options, fallback) => {
  const res = await apiFetch(path, options);
  if (!res.ok) throw new Error(await readError(res, fallback));
  return res.json();
};

const VehiclePicker = ({ vehicles, value, onChange, label = 'Vehicles', size = 'small' }) => (
  <FormControl size={size} fullWidth>
    {/* Shrunk and notched up front: with displayEmpty the empty value still renders
        "None yet", and an unshrunk label would sit on top of it. */}
    <InputLabel shrink>{label}</InputLabel>
    <Select
      multiple value={value} label={label} input={<OutlinedInput notched label={label} />}
      onChange={(event) => onChange(event.target.value)}
      renderValue={(selected) => (selected.length
        ? vehicles.filter((vehicle) => selected.includes(vehicle.id)).map((vehicle) => vehicle.name).join(', ')
        : 'None yet')}
      displayEmpty
    >
      {vehicles.map((vehicle) => <MenuItem key={vehicle.id} value={vehicle.id}>{vehicle.name}</MenuItem>)}
    </Select>
  </FormControl>
);

const RoleChip = ({ role }) => (
  <Chip size="small" variant="outlined" color={role === 'driver' ? 'default' : 'primary'} label={FLEET_ROLES[role]?.label || role} />
);

const copy = async (text) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Link copied');
  } catch {
    toast.message(text);
  }
};

/**
 * Fleets: the people let into this account, and the accounts this person is let into.
 *
 * Invitations go by email, and the link also comes back here right away, so a fleet
 * can be put together before outgoing mail works — the owner sends it however they
 * like. Only the owner manages membership; a manager runs the records, not the people.
 */
const FleetPage = () => {
  const { workspace, inFleetWorkspace, switchWorkspace } = useAuth();
  const [data, setData] = useState(null);
  const [invite, setInvite] = useState({ email: '', role: 'driver', vehicle_ids: [] });
  const [busy, setBusy] = useState(false);
  // Links come back only when an invitation is created or renewed — the server keeps
  // a hash, not the link — so they live here until the page is left.
  const [links, setLinks] = useState({});

  const load = useCallback(async () => {
    try {
      setData(await request('/api/fleet', {}, 'Could not load the fleet'));
    } catch (error) {
      toast.error(error.message);
      setData({ vehicles: [], members: [], invitations: [], memberships: [], incoming: [] });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (fn, success) => {
    setBusy(true);
    try {
      const result = await fn();
      if (success) toast.success(success);
      await load();
      return result;
    } catch (error) {
      toast.error(error.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const sendInvite = async (event) => {
    event.preventDefault();
    const created = await act(() => request('/api/fleet/invitations', {
      method: 'POST',
      body: JSON.stringify({ ...invite, email: invite.email.trim(), vehicle_ids: invite.role === 'driver' ? invite.vehicle_ids : [] }),
    }, 'Could not send the invitation'), 'Invitation sent');
    if (created) {
      setLinks((current) => ({ ...current, [created.id]: created.link }));
      setInvite({ email: '', role: invite.role, vehicle_ids: [] });
    }
  };

  const renew = async (id) => {
    const renewed = await act(() => request(`/api/fleet/invitations/${id}/renew`, { method: 'POST' }, 'Could not renew'), 'New link sent');
    if (renewed) setLinks((current) => ({ ...current, [renewed.id]: renewed.link }));
  };

  const updateMember = (memberId, changes) => act(() => request(`/api/fleet/members/${memberId}`, {
    method: 'PATCH', body: JSON.stringify(changes),
  }, 'Could not update the member'), 'Saved');

  const accept = async (invitationId) => {
    const joined = await act(() => request('/api/fleet/invitations/accept', {
      method: 'POST', body: JSON.stringify({ invitation_id: invitationId }),
    }, 'Could not accept'));
    if (joined) switchWorkspace(joined.owner_id);
  };

  if (!data) {
    return <Box className="section-shell" sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress /></Box>;
  }

  const { vehicles, members, invitations, memberships, incoming } = data;

  return (
    <Box className="section-shell stagger">
      <Typography variant="h4" component="h1" fontWeight={800} sx={{ mb: 0.5 }}>Fleet</Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
        Let drivers and managers work on your vehicles from their own accounts. Everything they record lands in your
        records, under your plan.
      </Typography>

      <Stack spacing={3} sx={{ maxWidth: 860, minWidth: 0 }}>
        {inFleetWorkspace ? (
          <Alert severity="info" action={<Button color="inherit" size="small" onClick={() => switchWorkspace(null)}>My account</Button>}>
            You are working in <strong>{workspace.owner_name}</strong>&apos;s fleet as a {FLEET_ROLES[workspace.role]?.label.toLowerCase()}.
            This page manages your own account&apos;s fleet.
          </Alert>
        ) : null}

        {incoming.length ? (
          <Paper sx={{ p: 2.5, borderRadius: 4, borderColor: 'primary.main' }} variant="outlined">
            <Typography variant="h6" gutterBottom>Invitations for you</Typography>
            <Stack divider={<Divider flexItem />} spacing={1.5}>
              {incoming.map((item) => (
                <Stack key={item.id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography fontWeight={600}>{item.owner_name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      As a {FLEET_ROLES[item.role]?.label.toLowerCase()}
                      {item.role === 'driver' ? ` · ${item.vehicle_count} vehicle${item.vehicle_count === 1 ? '' : 's'}` : ''}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={1}>
                    <Button variant="contained" disabled={busy} onClick={() => accept(item.id)}>Join</Button>
                    <Button disabled={busy} onClick={() => act(() => request(`/api/fleet/invitations/${item.id}/decline`, { method: 'POST' }, 'Could not decline'), 'Declined')}>Decline</Button>
                  </Stack>
                </Stack>
              ))}
            </Stack>
          </Paper>
        ) : null}

        {memberships.length ? (
          <Paper sx={{ p: 2.5, borderRadius: 4 }}>
            <Typography variant="h6" gutterBottom>Fleets you belong to</Typography>
            <Stack divider={<Divider flexItem />} spacing={1.5}>
              {memberships.map((item) => {
                const current = workspace && String(workspace.tenant_id) === String(item.owner_id);
                return (
                  <Stack key={item.owner_id} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography fontWeight={600} noWrap>{item.owner_name}</Typography>
                        <RoleChip role={item.role} />
                      </Stack>
                      <Typography variant="body2" color="text.secondary">
                        {item.role === 'driver'
                          ? `${item.vehicle_count} vehicle${item.vehicle_count === 1 ? '' : 's'} assigned to you`
                          : 'Every vehicle'}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button variant={current ? 'outlined' : 'contained'} disabled={current} onClick={() => switchWorkspace(item.owner_id)}>
                        {current ? 'Open now' : 'Open'}
                      </Button>
                      <Button color="error" disabled={busy} onClick={async () => {
                        const left = await act(() => request(`/api/fleet/memberships/${item.owner_id}`, { method: 'DELETE' }, 'Could not leave'), 'You left the fleet');
                        if (left && current) switchWorkspace(null);
                      }}>Leave</Button>
                    </Stack>
                  </Stack>
                );
              })}
            </Stack>
          </Paper>
        ) : null}

        <Paper component="form" onSubmit={sendInvite} sx={{ p: 2.5, borderRadius: 4 }}>
          <Typography variant="h6" gutterBottom>Invite someone</Typography>
          <ToggleButtonGroup
            exclusive size="small" value={invite.role} sx={{ mb: 1 }}
            onChange={(_event, role) => role && setInvite({ ...invite, role })}
          >
            {Object.entries(FLEET_ROLES).map(([value, role]) => <ToggleButton key={value} value={value}>{role.label}</ToggleButton>)}
          </ToggleButtonGroup>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{FLEET_ROLES[invite.role].hint}</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
            <TextField
              label="Email address" type="email" size="small" required fullWidth value={invite.email}
              onChange={(event) => setInvite({ ...invite, email: event.target.value })}
            />
            {invite.role === 'driver' ? (
              <VehiclePicker vehicles={vehicles} value={invite.vehicle_ids} onChange={(ids) => setInvite({ ...invite, vehicle_ids: ids })} />
            ) : null}
            <Button type="submit" variant="contained" disabled={busy || !invite.email.includes('@')} sx={{ flexShrink: 0 }}>
              Invite
            </Button>
          </Stack>
          {invite.role === 'driver' && !vehicles.length ? (
            <Alert severity="warning" variant="outlined" sx={{ mt: 2 }}>Add a vehicle first, so there is something to assign.</Alert>
          ) : null}
        </Paper>

        <Paper sx={{ p: 2.5, borderRadius: 4 }}>
          <Typography variant="h6" gutterBottom>Your fleet</Typography>
          {!members.length && !invitations.length ? (
            <Typography variant="body2" color="text.secondary">Just you so far.</Typography>
          ) : null}
          <Stack divider={<Divider flexItem />} spacing={2}>
            {members.map((member) => (
              <Stack key={member.member_id} spacing={1.25}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography fontWeight={600} noWrap>{member.username}</Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>{member.email}</Typography>
                  </Box>
                  <Tooltip title="Remove from the fleet. What they recorded stays.">
                    <IconButton aria-label={`Remove ${member.username}`} disabled={busy} onClick={() => act(
                      () => request(`/api/fleet/members/${member.member_id}`, { method: 'DELETE' }, 'Could not remove'),
                      `${member.username} removed`,
                    )}>
                      <RemoveIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <FormControl size="small" sx={{ minWidth: 150 }}>
                    <InputLabel>Role</InputLabel>
                    <Select label="Role" value={member.role} disabled={busy}
                      onChange={(event) => updateMember(member.member_id, { role: event.target.value })}>
                      {Object.entries(FLEET_ROLES).map(([value, role]) => <MenuItem key={value} value={value}>{role.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  {member.role === 'driver' ? (
                    <VehiclePicker vehicles={vehicles} value={member.vehicle_ids}
                      onChange={(ids) => updateMember(member.member_id, { vehicle_ids: ids })} />
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>Every vehicle</Typography>
                  )}
                </Stack>
              </Stack>
            ))}
            {invitations.map((item) => (
              <Stack key={item.id} spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography fontWeight={600} noWrap>{item.email}</Typography>
                      <Chip size="small" label="Invited" />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                      {FLEET_ROLES[item.role]?.label}
                      {item.role === 'driver' ? ` · ${item.vehicle_names.join(', ') || 'no vehicles'}` : ''}
                      {' · '}valid until {new Date(item.expires_at).toLocaleDateString()}
                    </Typography>
                  </Box>
                  <Tooltip title="New link (the old one stops working)">
                    <IconButton aria-label="New link" disabled={busy} onClick={() => renew(item.id)}><RenewIcon /></IconButton>
                  </Tooltip>
                  <Tooltip title="Withdraw">
                    <IconButton aria-label="Withdraw invitation" disabled={busy} onClick={() => act(
                      () => request(`/api/fleet/invitations/${item.id}`, { method: 'DELETE' }, 'Could not withdraw'), 'Invitation withdrawn',
                    )}>
                      <RemoveIcon />
                    </IconButton>
                  </Tooltip>
                </Stack>
                {links[item.id] ? (
                  <Stack direction="row" spacing={1} alignItems="center">
                    <TextField size="small" fullWidth value={links[item.id]} InputProps={{ readOnly: true }}
                      helperText="Also sent by email. You can pass this link on yourself." />
                    <IconButton aria-label="Copy link" onClick={() => copy(links[item.id])} sx={{ alignSelf: 'flex-start' }}><CopyIcon /></IconButton>
                  </Stack>
                ) : null}
              </Stack>
            ))}
          </Stack>
        </Paper>

        <Alert severity="info" variant="outlined">
          Members use their own sign-in, and your plan covers them. Drivers see and record only the vehicles assigned to
          them; managers see everything and can add vehicles and costs, but only you manage who is in the fleet.
        </Alert>
      </Stack>
    </Box>
  );
};

export default FleetPage;
