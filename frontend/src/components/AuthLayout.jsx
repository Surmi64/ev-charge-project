import React from 'react';
import { Alert, Box, Card, Container, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  BoltOutlined as EnergyIcon,
  ReceiptLongOutlined as CostIcon,
  SpeedOutlined as RateIcon,
} from '@mui/icons-material';
import OdometerWordmark from './OdometerWordmark';
import { useSiteConfig } from '../utils/useSiteConfig';

// Deliberately describing the product as it actually is. The panel used to advertise
// an "Industrial Ops Dashboard" with "Single-user control", which read as a demo skin
// and contradicted a multi-tenant subscription product.
const HIGHLIGHTS = [
  {
    icon: EnergyIcon,
    title: 'Every fuel type',
    body: 'Electric, hybrid, petrol and diesel side by side, each asking only for the fields that apply.',
  },
  {
    icon: CostIcon,
    title: 'Everything, not just the pump',
    body: 'Insurance, road tax, servicing and tolls counted alongside charging and fuelling.',
  },
  {
    icon: RateIcon,
    title: 'The number that matters',
    body: 'Cost per 100 km for each vehicle, so comparing them is a fact rather than a feeling.',
  },
];

/**
 * Shared shell for sign in, registration and password recovery.
 *
 * Two panels: the product on the left, the form on the right. Below `md` the product
 * panel is dropped rather than stacked — on a phone the form is the entire reason the
 * page was opened, and pushing it under three paragraphs of copy just adds scrolling.
 * The wordmark moves into the form card there so the page still identifies itself.
 */
const AuthLayout = ({ kicker, title, subtitle, children, footer }) => {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';
  const { maintenance_notice: maintenanceNotice } = useSiteConfig();

  return (
    <Box className="auth-shell">
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 460px)' },
            gap: { xs: 3, md: 6 },
            alignItems: 'center',
          }}
        >
          <Box sx={{ display: { xs: 'none', md: 'block' }, position: 'relative' }}>
            {/* Room to spare here, unlike the sidebar header it is sized for. */}
            <OdometerWordmark scale={1.45} />
            <Typography
              variant="h1"
              // Styled as a display heading but rendered as a paragraph: it is a
              // tagline, not the page's subject. The form card carries the only h1
              // ("Sign in", "Create your account"), which keeps one h1 per page and
              // avoids a hidden heading outranking the visible one on mobile.
              component="p"
              sx={{
                mt: 3,
                fontSize: 'clamp(2.1rem, 3.4vw, 3rem)',
                lineHeight: 1.04,
                letterSpacing: '0.01em',
                textTransform: 'uppercase',
              }}
            >
              Know what your cars actually cost
            </Typography>
            <Typography
              variant="body1"
              color="text.secondary"
              sx={{ mt: 2, maxWidth: '46ch', lineHeight: 1.65 }}
            >
              Mileage records charging, fuelling and every ownership cost across a mixed
              fleet, then reports what each vehicle really costs to run.
            </Typography>

            <Box sx={{ mt: 4, display: 'grid', gap: 2.5 }}>
              {HIGHLIGHTS.map((highlight) => {
                // Bound here rather than destructured in the parameter list: this
                // config has no eslint-plugin-react, so JSX does not count as a use
                // and only names matching ^[A-Z_] are exempt — which covers variables
                // but not parameters.
                const Icon = highlight.icon;
                const { title: heading, body } = highlight;
                return (
                <Box key={heading} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                  <Box
                    aria-hidden="true"
                    sx={{
                      flexShrink: 0,
                      width: 40,
                      height: 40,
                      borderRadius: 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid',
                      borderColor: alpha(theme.palette.primary.main, isDark ? 0.35 : 0.3),
                      bgcolor: alpha(theme.palette.primary.main, isDark ? 0.1 : 0.08),
                    }}
                  >
                    <Icon sx={{ color: 'primary.main', fontSize: 21 }} />
                  </Box>
                  <Box>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                      {heading}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, maxWidth: '44ch' }}>
                      {body}
                    </Typography>
                  </Box>
                </Box>
                );
              })}
            </Box>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 4 }}>
              Free for 30 days, then €5 a month or €50 a year. Reading and exporting your
              own records is never blocked, subscribed or not.
            </Typography>
          </Box>

          <Card
            sx={{
              p: { xs: 2.5, sm: 4 },
              borderRadius: 4,
              position: 'relative',
              border: '1px solid',
              borderColor: 'divider',
              boxShadow: isDark
                ? `0 24px 60px ${alpha('#000', 0.5)}, 0 0 24px ${alpha(theme.palette.primary.main, 0.1)}`
                : `0 18px 44px ${alpha(theme.palette.primary.main, 0.12)}`,
            }}
          >
            <Box sx={{ display: { xs: 'flex', md: 'none' }, justifyContent: 'center', mb: 3 }}>
              <OdometerWordmark />
            </Box>

            {maintenanceNotice ? (
              <Alert severity="warning" sx={{ mb: 2.5 }} role="status">{maintenanceNotice}</Alert>
            ) : null}

            {kicker ? <Typography className="industrial-kicker">{kicker}</Typography> : null}
            <Typography variant="h5" component="h1" sx={{ mb: subtitle ? 0.75 : 2.5 }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3, lineHeight: 1.6 }}>
                {subtitle}
              </Typography>
            ) : null}

            {children}

            {footer ? <Box sx={{ mt: 3 }}>{footer}</Box> : null}
          </Card>
        </Box>
      </Container>
    </Box>
  );
};

export default AuthLayout;
