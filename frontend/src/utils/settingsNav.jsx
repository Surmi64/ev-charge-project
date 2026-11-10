import React from 'react';
import {
  CreditCard as BillingIcon,
  AdminPanelSettings as AdminIcon,
  Feedback as FeedbackIcon,
  Groups as FleetIcon,
} from '@mui/icons-material';

/**
 * The destinations that are not one of the five primary ones.
 *
 * Shared rather than declared where they are drawn, because they are drawn in two
 * places now: the sidebar on desktop, and the Account page on mobile. They used to
 * live only in the sidebar, which is hidden below `sm` — so on a phone Subscription
 * and Admin had no entry point at all and were reachable only by typing the URL.
 *
 * The bottom bar deliberately stays at five items (Material caps it there, and a
 * sixth would squeeze the labels), so the overflow belongs on a page, not in the bar.
 */
export const getSettingsItems = (user) => {
  const items = [
    // `primary`: on desktop these sit in the sidebar's main navigation rather than
    // under Settings. A phone's bottom bar has no room past its five, so there they
    // stay here, at the top of the Account page's list.
    {
      text: 'Fleet',
      description: 'Drivers and managers on your vehicles',
      icon: <FleetIcon />,
      path: '/fleet',
      primary: true,
    },
    {
      text: 'Feedback',
      description: 'Ideas, bug reports and complaints',
      icon: <FeedbackIcon />,
      path: '/feedback',
      primary: true,
    },
    {
      text: 'Subscription',
      description: 'Plan, trial status and billing',
      icon: <BillingIcon />,
      path: '/billing',
    },
  ];

  if (user?.role === 'admin') {
    // Flagged and sitting apart from the ordinary settings: it reaches every account
    // on the instance, not just this one.
    items.push({
      text: 'Admin',
      description: 'Users, feedback and site settings for the whole instance',
      icon: <AdminIcon />,
      path: '/admin',
      danger: true,
    });
  }

  return items;
};
