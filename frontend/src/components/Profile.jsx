import React, { useState, useEffect } from 'react';
import { Alert, Box, Paper, Typography, TextField, Button, CircularProgress, Chip, Stack, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Tab, Tabs, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAuth } from '../context/useAuth';
import UnitSettings from './UnitSettings';
import ClimateSettings from './ClimateSettings';
import FuelComparisonSettings from './FuelComparisonSettings';
import CostPerKmSettings from './CostPerKmSettings';
import NotificationSettings from './NotificationSettings';
import AccountDataSettings from './AccountDataSettings';
import SessionsCard from './SessionsCard';
import AppearanceSettings from './AppearanceSettings';
import PasswordField from './PasswordField';
import { toast } from 'sonner';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getSettingsItems } from '../utils/settingsNav';
import { apiFetch } from '../utils/api';

// The page used to be seven cards stacked in one column, each with its own Save
// button, which read as a pile rather than as settings. The tab lives in the URL,
// like Records, so a link can point straight at one of them.
const TABS = [
    { value: 'profile', label: 'Profile' },
    { value: 'display', label: 'Display' },
    { value: 'calculations', label: 'Calculations' },
    { value: 'notifications', label: 'Notifications' },
    { value: 'security', label: 'Security' },
];
const TAB_VALUES = TABS.map((tab) => tab.value);

const formatEventLabel = (value) => value.replace(/_/g, ' ');

const ProfileForm = ({ user, updateUser }) => {
    const [username, setUsername] = useState(user.username || '');
    const [email, setEmail] = useState(user.email || '');
    const [currentPassword, setCurrentPassword] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setUsername(user.username || '');
        setEmail(user.email || '');
    }, [user.username, user.email]);

    // The password is asked for only when the email changes: the email is what a
    // password reset goes to, so changing it is how an account gets taken over.
    // The display name carries no such weight.
    const emailChanged = email.trim() !== (user.email || '');
    const dirty = emailChanged || username.trim() !== (user.username || '');

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (emailChanged && !currentPassword) {
            toast.error('Enter your current password to change the email address');
            return;
        }
        setSaving(true);
        try {
            const res = await apiFetch('/api/auth/me', {
                method: 'PATCH',
                body: JSON.stringify({
                    username: username.trim() !== user.username ? username.trim() : undefined,
                    email: emailChanged ? email.trim() : undefined,
                    current_password: emailChanged ? currentPassword : undefined,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Could not save your profile');
            updateUser(emailChanged
                ? { username: username.trim(), email: email.trim(), email_verified_at: null }
                : { username: username.trim() });
            setCurrentPassword('');
            toast.success('Profile saved');
        } catch (error) {
            toast.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
            <Typography variant="h6" gutterBottom>Profile</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Member since {new Date(user.created_at).toLocaleDateString()}.
            </Typography>
            <form onSubmit={handleSubmit}>
                <TextField fullWidth label="Username" value={username}
                    onChange={(event) => setUsername(event.target.value)} margin="normal" autoComplete="username" />
                <TextField fullWidth label="Email" type="email" value={email}
                    onChange={(event) => setEmail(event.target.value)} margin="normal" autoComplete="email" />
                {!emailChanged ? <EmailStatus user={user} /> : null}
                {emailChanged ? (
                    <Box sx={{ mt: 2 }}>
                        <PasswordField
                            label="Current password"
                            value={currentPassword}
                            onChange={(event) => setCurrentPassword(event.target.value)}
                            helperText="Needed to change the email address."
                        />
                    </Box>
                ) : null}
                <Button type="submit" variant="contained" disabled={!dirty || saving} sx={{ mt: 2.5 }}>
                    {saving ? 'Saving…' : 'Save profile'}
                </Button>
            </form>
        </Paper>
    );
};

// Whether the sign-in address is proven, with a way to prove it. Quiet when it is.
const EmailStatus = ({ user }) => {
    const [sending, setSending] = useState(false);
    if (user.email_verified_at) {
        return <Chip size="small" color="success" variant="outlined" label="Confirmed" sx={{ mt: 0.5 }} />;
    }
    const resend = async () => {
        setSending(true);
        try {
            const res = await apiFetch('/api/auth/verify-email/resend', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Could not send the link');
            toast.success(data.message);
        } catch (error) {
            toast.error(error.message);
        } finally {
            setSending(false);
        }
    };
    return (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
            <Chip size="small" color="warning" variant="outlined" label="Not confirmed" />
            <Button size="small" onClick={resend} disabled={sending}>Send confirmation link</Button>
        </Stack>
    );
};

const PasswordForm = ({ onChanged }) => {
    const [form, setForm] = useState({ current: '', next: '', confirm: '' });
    const [saving, setSaving] = useState(false);
    const set = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));
    const mismatch = Boolean(form.confirm) && form.next !== form.confirm;

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (form.next !== form.confirm) {
            toast.error('New passwords do not match');
            return;
        }
        setSaving(true);
        try {
            const res = await apiFetch('/api/auth/me', {
                method: 'PATCH',
                body: JSON.stringify({ current_password: form.current, new_password: form.next }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.detail || 'Could not change the password');
            setForm({ current: '', next: '', confirm: '' });
            toast.success('Password changed');
            onChanged();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
            <Typography variant="h6" gutterBottom>Password</Typography>
            <form onSubmit={handleSubmit}>
                <Stack spacing={2} sx={{ mt: 1.5 }}>
                    <PasswordField label="Current password" value={form.current} onChange={set('current')} />
                    <PasswordField label="New password" value={form.next} onChange={set('next')}
                        autoComplete="new-password" showPolicy />
                    <PasswordField label="Confirm new password" value={form.confirm} onChange={set('confirm')}
                        autoComplete="new-password" error={mismatch ? 'Does not match the new password' : undefined} />
                </Stack>
                <Button type="submit" variant="contained" sx={{ mt: 2.5 }}
                    disabled={saving || !form.current || !form.next || mismatch}>
                    {saving ? 'Changing…' : 'Change password'}
                </Button>
            </form>
        </Paper>
    );
};

const SecurityLog = ({ entries, loading }) => {
    const theme = useTheme();

    // These were the dark-mode brand green, red and amber written out by hand, which
    // meant the audit-log chips kept their neons in light mode and landed near 1:1.
    const getStatusChipSx = (status) => {
        const color = status === 'success' ? theme.palette.success.main
            : status === 'failed' ? theme.palette.error.main
                : theme.palette.warning.main;

        return {
            color,
            borderColor: alpha(color, 0.34),
            backgroundColor: alpha(color, 0.12),
        };
    };

    return (
        <Paper sx={{ p: 2.5, borderRadius: 4, bgcolor: 'background.paper' }}>
            <Typography variant="h6" gutterBottom>Recent activity</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.75 }}>
                Sign-ins, password resets and profile changes on this account.
            </Typography>

            {loading ? (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={28} />
                </Box>
            ) : entries.length ? (
                <Stack spacing={1}>
                    {entries.map((entry) => (
                        <Box key={entry.id} sx={{ p: 1.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', backgroundColor: alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.02 : 0.03) }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.25, mb: 0.75 }}>
                                <Box>
                                    <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'capitalize', lineHeight: 1.3 }}>
                                        {formatEventLabel(entry.event_type)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {entry.created_at ? new Date(entry.created_at).toLocaleString() : 'Unknown time'}
                                    </Typography>
                                </Box>
                                <Chip size="small" label={entry.status} variant="outlined" sx={getStatusChipSx(entry.status)} />
                            </Box>
                            {entry.ip_address ? (
                                <Typography variant="body2" color="text.secondary">
                                    IP: {entry.ip_address}
                                </Typography>
                            ) : null}
                            {entry.details && Object.keys(entry.details).length ? (
                                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, wordBreak: 'break-word' }}>
                                    {Object.entries(entry.details).map(([key, value]) => `${formatEventLabel(key)}: ${String(value)}`).join(' • ')}
                                </Typography>
                            ) : null}
                        </Box>
                    ))}
                </Stack>
            ) : (
                <Typography color="text.secondary">No recent security activity recorded yet.</Typography>
            )}
        </Paper>
    );
};

const Profile = () => {
    const { token, user, account, updateUser, loading: authLoading, inFleetWorkspace, workspace, switchWorkspace } = useAuth();
    // In a fleet, units, currency and the calculation settings are the owner's — they
    // belong to the records — so those cards make way for a note rather than editing
    // this person's own row, which would change nothing on screen.
    const fleetNotice = inFleetWorkspace ? (
        <Alert severity="info" variant="outlined"
            action={<Button color="inherit" size="small" onClick={() => switchWorkspace(null)}>My account</Button>}>
            In {workspace.owner_name}&apos;s fleet these are the owner&apos;s settings. Switch to your own account to
            change yours.
        </Alert>
    ) : null;
    const navigate = useNavigate();
    const settingsItems = getSettingsItems(user);
    const [searchParams, setSearchParams] = useSearchParams();
    const tab = TAB_VALUES.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'profile';
    const [securityLoading, setSecurityLoading] = useState(true);
    const [securityLog, setSecurityLog] = useState([]);

    const setTab = (next) => {
        const params = new URLSearchParams(searchParams);
        if (next === 'profile') params.delete('tab');
        else params.set('tab', next);
        setSearchParams(params, { replace: true });
    };

    const fetchSecurityLog = React.useCallback(async () => {
        if (!token) {
            setSecurityLoading(false);
            return;
        }
        try {
            const res = await apiFetch('/api/auth/security-log?limit=10');
            if (!res.ok) throw new Error('Failed to load security activity');
            setSecurityLog(await res.json());
        } catch {
            toast.error('Failed to load security activity');
        } finally {
            setSecurityLoading(false);
        }
    }, [token]);

    useEffect(() => { fetchSecurityLog(); }, [fetchSecurityLog]);

    if (authLoading || !user) {
        return <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}><CircularProgress /></Box>;
    }

    return (
        <Box className="section-shell stagger">
            <Typography variant="h4" component="h1" fontWeight={800} sx={{ mb: 0.5 }}>
                Account
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                Your profile, how figures are shown, and what the forecasts assume.
            </Typography>

            {/* minWidth 0: a scrollable Tabs reports its full content width as its
                minimum, and without this the column grows to fit it on a phone. */}
            <Stack spacing={3} sx={{ maxWidth: 760, minWidth: 0 }}>
                {/* Mobile only. On desktop these sit in the sidebar, and repeating them
                    here would give one screen two ways to reach the same page; below
                    `sm` the sidebar is hidden and this is the only way in. */}
                {settingsItems.length ? (
                    <Paper sx={{ display: { xs: 'block', sm: 'none' }, p: 1, borderRadius: 4, bgcolor: 'background.paper' }}>
                        <List disablePadding>
                            {settingsItems.map((item) => (
                                <ListItem key={item.path} disablePadding>
                                    <ListItemButton
                                        onClick={() => navigate(item.path)}
                                        sx={{ borderRadius: 2, py: 1.5 }}
                                    >
                                        <ListItemIcon sx={{ color: item.danger ? 'error.main' : 'primary.main', minWidth: 44 }}>
                                            {item.icon}
                                        </ListItemIcon>
                                        <ListItemText
                                            primary={item.text}
                                            secondary={item.description}
                                            slotProps={{
                                                primary: { fontWeight: 600, color: item.danger ? 'error.main' : 'text.primary' },
                                                secondary: { variant: 'caption' },
                                            }}
                                        />
                                        <ChevronRightIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                                    </ListItemButton>
                                </ListItem>
                            ))}
                        </List>
                    </Paper>
                ) : null}

                <Box sx={{ minWidth: 0 }}>
                    <Tabs value={tab} onChange={(_, next) => setTab(next)} variant="scrollable" allowScrollButtonsMobile sx={{ mb: 2 }}>
                        {TABS.map((item) => <Tab key={item.value} value={item.value} label={item.label} />)}
                    </Tabs>

                    {tab === 'profile' ? (
                        <Stack spacing={3}>
                            <ProfileForm user={account || user} updateUser={updateUser} />
                            <PasswordForm onChanged={fetchSecurityLog} />
                            <AccountDataSettings />
                        </Stack>
                    ) : null}

                    {tab === 'display' ? (
                        <Stack spacing={3}>
                            <AppearanceSettings />
                            {fleetNotice || <UnitSettings />}
                        </Stack>
                    ) : null}

                    {tab === 'calculations' && fleetNotice ? fleetNotice : null}
                    {tab === 'calculations' && !fleetNotice ? (
                        <Stack spacing={3}>
                            <Typography variant="body2" color="text.secondary">
                                What Analytics assumes when it projects the year, measures cost per distance and draws the petrol comparison.
                                Your recorded figures are never changed by these.
                            </Typography>
                            <CostPerKmSettings />
                            <ClimateSettings />
                            <FuelComparisonSettings />
                        </Stack>
                    ) : null}

                    {tab === 'notifications' ? (fleetNotice || <NotificationSettings />) : null}

                    {tab === 'security' ? (
                        <Stack spacing={3}>
                            <SessionsCard />
                            <SecurityLog entries={securityLog} loading={securityLoading} />
                        </Stack>
                    ) : null}
                </Box>
            </Stack>
        </Box>
    );
};

export default Profile;
