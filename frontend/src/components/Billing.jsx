import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CheckCircleOutline as CheckIcon } from '@mui/icons-material';
import { toast } from 'sonner';
import { useAuth } from '../context/useAuth';
import { apiFetch } from '../utils/api';
import { getCategoryBoxSx } from '../utils/categoryVisuals';

const STATUS_LABEL = {
  trialing: { label: 'Trial', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  past_due: { label: 'Past due', tone: 'warning' },
  canceled: { label: 'Canceled', tone: 'warning' },
  expired: { label: 'Expired', tone: 'error' },
};

const formatPrice = (cents, currency) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 0 }).format(cents / 100);

const Billing = () => {
  const theme = useTheme();
  const { subscription, refreshSubscription } = useAuth();
  const [plans, setPlans] = useState(null);
  const [trialDays, setTrialDays] = useState(30);

  useEffect(() => {
    apiFetch('/api/billing/plans')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setPlans(data.plans);
        setTrialDays(data.trial_days);
      })
      .catch(() => toast.error('Could not load pricing'));
    refreshSubscription().catch(() => {});
  }, [refreshSubscription]);

  const status = subscription?.status || 'trialing';
  const meta = STATUS_LABEL[status] || STATUS_LABEL.trialing;
  const daysLeft = subscription?.days_remaining;

  return (
    <Box className="section-shell stagger">
      <Typography variant="h4" component="h1" fontWeight="800" sx={{ mb: 0.75 }}>
        Subscription
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Your plan, renewal date and what happens when it lapses.
      </Typography>

      <Card sx={{ ...getCategoryBoxSx(theme, 'other'), p: 3, borderRadius: 4, mb: 3, maxWidth: 760 }}>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          <Typography variant="h6" fontWeight={700}>Current plan</Typography>
          <Chip size="small" label={meta.label} color={meta.tone} variant="outlined" />
          {subscription?.plan && subscription.plan !== 'trial' ? (
            <Chip size="small" label={subscription.plan} variant="outlined" />
          ) : null}
        </Stack>

        {status === 'trialing' ? (
          <Typography color="text.secondary">
            {daysLeft === 0
              ? 'Your trial ends today.'
              : `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left of your ${trialDays}-day trial.`}
          </Typography>
        ) : null}

        {status === 'active' && subscription?.current_period_end ? (
          <Typography color="text.secondary">
            Renews on {new Date(subscription.current_period_end).toLocaleDateString()}.
          </Typography>
        ) : null}

        {!subscription?.can_write ? (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Your plan has ended. Your data is still here — you can view it and export it to CSV at any time,
            but adding or editing entries needs an active plan.
          </Alert>
        ) : null}
      </Card>

      <Typography variant="h6" fontWeight={700} sx={{ mb: 1.5 }}>Plans</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {(plans || []).map((plan) => (
          <Card
            key={plan.id}
            sx={{
              p: 3,
              borderRadius: 4,
              flex: '1 1 260px',
              maxWidth: 360,
              border: '1px solid',
              borderColor:
                subscription?.plan === plan.id
                  ? theme.palette.primary.main
                  : alpha(theme.palette.divider, 1),
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <Typography variant="h6" fontWeight={700}>{plan.name}</Typography>
              {plan.savings_percent ? (
                <Chip size="small" color="success" variant="outlined" label={`Save ${plan.savings_percent}%`} />
              ) : null}
            </Stack>
            <Typography variant="h4" component="div" fontWeight={800} sx={{ mb: 0.5 }}>
              {formatPrice(plan.amount_cents, plan.currency)}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              per {plan.interval}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            <Stack spacing={1}>
              {['Unlimited vehicles', 'Charging, fueling and cost tracking', 'Analytics and CSV export'].map((line) => (
                <Stack key={line} direction="row" spacing={1} alignItems="center">
                  <CheckIcon fontSize="small" color="success" />
                  <Typography variant="body2">{line}</Typography>
                </Stack>
              ))}
            </Stack>
            <Button
              fullWidth
              variant={subscription?.plan === plan.id ? 'outlined' : 'contained'}
              sx={{ mt: 2.5 }}
              disabled
            >
              {subscription?.plan === plan.id && status === 'active' ? 'Current plan' : 'Coming soon'}
            </Button>
          </Card>
        ))}
      </Box>

      <Alert severity="info" sx={{ mt: 3, maxWidth: 760 }}>
        Online payment is not connected yet. Plans are activated manually for now — get in touch and we will
        switch your account over.
      </Alert>
    </Box>
  );
};

export default Billing;
