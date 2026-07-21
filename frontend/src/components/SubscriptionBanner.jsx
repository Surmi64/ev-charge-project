import React from 'react';
import { Alert, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';

// Shown above the page content when the plan needs attention. Stays quiet during a
// comfortable trial so it does not nag from day one.
const NAG_FROM_DAYS_LEFT = 7;

const SubscriptionBanner = () => {
  const { subscription } = useAuth();
  const navigate = useNavigate();

  if (!subscription) return null;

  const { status, days_remaining: daysLeft, can_write: canWrite } = subscription;

  let severity = null;
  let message = null;

  if (!canWrite) {
    severity = 'warning';
    message = 'Your plan has ended. You can still view and export everything, but new entries are paused.';
  } else if (status === 'trialing' && daysLeft !== null && daysLeft <= NAG_FROM_DAYS_LEFT) {
    severity = daysLeft <= 2 ? 'warning' : 'info';
    message =
      daysLeft === 0
        ? 'Your trial ends today.'
        : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left of your trial.`;
  }

  if (!message) return null;

  return (
    <Alert
      severity={severity}
      sx={{ mb: 2, borderRadius: 2 }}
      action={
        <Button color="inherit" size="small" onClick={() => navigate('/billing')}>
          View plans
        </Button>
      }
    >
      {message}
    </Alert>
  );
};

export default SubscriptionBanner;
