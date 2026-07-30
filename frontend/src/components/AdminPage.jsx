import React, { useCallback, useMemo } from 'react';
import { Box, Chip, Tab, Tabs, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import UserManagement from './UserManagement';
import SiteSettings from './SiteSettings';

// Order is the order of the tabs. Adding an area means adding a row here.
const TABS = [
  { value: 'users', label: 'Users', render: () => <UserManagement embedded /> },
  { value: 'site', label: 'Site settings', render: () => <SiteSettings /> },
];

/**
 * Everything instance-wide, behind one route.
 *
 * Kept as tabs rather than separate sidebar entries so the admin surface can grow
 * without the navigation growing with it.
 *
 * The active tab lives in the URL, matching Records: a reload, a bookmark or a link
 * to a colleague all land on the same tab. An unknown value falls back to the first
 * rather than rendering nothing.
 */
const AdminPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get('tab');
  const active = useMemo(
    () => (TABS.some((tab) => tab.value === requested) ? requested : TABS[0].value),
    [requested],
  );

  const selectTab = useCallback((_event, value) => {
    // replace: flipping between tabs should not fill the back button with history.
    setSearchParams(value === TABS[0].value ? {} : { tab: value }, { replace: true });
  }, [setSearchParams]);

  const current = TABS.find((tab) => tab.value === active);

  return (
    <Box className="section-shell stagger">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 0.5 }}>
        <Typography variant="h4" component="h1" fontWeight={800}>Admin</Typography>
        <Chip size="small" color="error" variant="outlined" label="Instance-wide" />
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        These controls affect every account on this deployment, not just yours.
      </Typography>

      <Tabs
        value={active}
        onChange={selectTab}
        sx={{ mb: 2.5, borderBottom: 1, borderColor: 'divider' }}
        aria-label="Admin sections"
      >
        {TABS.map((tab) => (
          <Tab key={tab.value} value={tab.value} label={tab.label} id={`admin-tab-${tab.value}`} />
        ))}
      </Tabs>

      <Box role="tabpanel" aria-labelledby={`admin-tab-${active}`}>
        {current.render()}
      </Box>
    </Box>
  );
};

export default AdminPage;
