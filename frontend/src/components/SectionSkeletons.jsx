import React from 'react';
import {
  Box,
  Card,
  Grid,
  Paper,
  Skeleton,
  Stack,
  useTheme,
} from '@mui/material';
import { alpha } from '@mui/material/styles';

export function DashboardSkeleton() {
  return (
    <Box className="section-shell">
      <Skeleton variant="text" width={180} height={56} sx={{ mb: 1 }} />

      <Grid container spacing={3} sx={{ mb: 4 }}>
        {[1, 2, 3].map((item) => (
          <Grid item xs={12} sm={4} key={item}>
            <Card sx={{ p: 3, borderRadius: 4 }}>
              <Skeleton variant="text" width="48%" height={26} />
              <Skeleton variant="text" width="72%" height={52} />
            </Card>
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        {[1, 2].map((item) => (
          <Grid item xs={12} sm={6} key={item}>
            <Card sx={{ p: 3, borderRadius: 4 }}>
              <Skeleton variant="text" width="42%" height={24} />
              <Skeleton variant="text" width="58%" height={44} />
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card sx={{ p: 3, borderRadius: 4, mb: 4 }}>
        <Skeleton variant="text" width={260} height={34} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={320} />
      </Card>

      <Card sx={{ p: 3, borderRadius: 4 }}>
        <Skeleton variant="text" width={200} height={34} sx={{ mb: 2 }} />
        <Stack spacing={2.25}>
          {[1, 2, 3].map((item) => (
            <Box key={item}>
              <Skeleton variant="text" width="38%" height={28} />
              <Skeleton variant="text" width="54%" height={22} />
              <Skeleton variant="text" width="78%" height={22} />
            </Box>
          ))}
        </Stack>
      </Card>
    </Box>
  );
}

export function AnalyticsSkeleton() {
  return (
    <Box className="section-shell">
      <Skeleton variant="text" width={160} height={56} sx={{ mb: 1 }} />

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card sx={{ p: 3, borderRadius: 4 }}>
            <Skeleton variant="text" width={300} height={34} sx={{ mb: 2 }} />
            <Skeleton variant="rounded" height={300} />
          </Card>
        </Grid>

        {[1, 2, 3, 4].map((item) => (
          <Grid item xs={12} md={6} key={item}>
            <Card sx={{ p: 3, borderRadius: 4, height: '100%' }}>
              <Skeleton variant="text" width="52%" height={34} sx={{ mb: 2 }} />
              <Skeleton variant="rounded" height={300} />
            </Card>
          </Grid>
        ))}

        {[1, 2].map((item) => (
          <Grid item xs={12} sm={6} key={`metric-${item}`}>
            <Card sx={{ p: 3, borderRadius: 4 }}>
              <Skeleton variant="text" width="46%" height={24} />
              <Skeleton variant="text" width="34%" height={56} />
              <Skeleton variant="text" width="62%" height={22} />
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}

export function FilterSkeleton() {
  const theme = useTheme();

  return (
    <Paper sx={{ p: 2.25, borderRadius: 4, mb: 1, boxShadow: `0 0 10px ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.05 : 0.08)}` }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.2fr 0.8fr 0.8fr' },
          gap: 2,
        }}
      >
        <Skeleton variant="rounded" height={56} />
        <Skeleton variant="rounded" height={56} />
        <Skeleton variant="rounded" height={56} />
      </Box>
    </Paper>
  );
}

export function TableSectionSkeleton({ rows = 5, showFilters = false }) {
  const theme = useTheme();

  return (
    <Box className="section-shell">
      <Skeleton variant="text" width={180} height={56} sx={{ mb: 1 }} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Skeleton variant="rounded" width={144} height={40} />
      </Box>
      {showFilters ? <FilterSkeleton /> : null}
      <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
        <Box sx={{ px: 3, py: 2 }}>
          <Skeleton variant="text" width="100%" height={26} />
        </Box>
        <Stack spacing={0}>
          {Array.from({ length: rows }).map((_, index) => (
            <Box key={index} sx={{ px: 3, py: 2.25, borderTop: index === 0 ? '1px solid transparent' : `1px solid ${alpha(theme.palette.text.primary, theme.palette.mode === 'dark' ? 0.06 : 0.08)}` }}>
              <Skeleton variant="text" width="28%" height={28} />
              <Skeleton variant="text" width="52%" height={22} />
            </Box>
          ))}
        </Stack>
      </Paper>
    </Box>
  );
}

export function TimelineSectionSkeleton() {
  return (
    <Box className="section-shell">
      <Skeleton variant="text" width={150} height={56} sx={{ mb: 1 }} />
      <Box sx={{ display: 'flex', gap: 1.25, flexWrap: 'wrap', justifyContent: 'flex-end', mb: 1 }}>
        <Skeleton variant="rounded" width={132} height={40} />
        <Skeleton variant="rounded" width={132} height={40} />
      </Box>
      <FilterSkeleton />
      <Card sx={{ p: { xs: 2, sm: 3 }, borderRadius: 4 }}>
        <Stack spacing={2.5}>
          {[1, 2, 3, 4].map((item) => (
            <Box key={item}>
              <Skeleton variant="text" width="42%" height={28} />
              <Skeleton variant="text" width="56%" height={22} />
              <Skeleton variant="text" width="72%" height={22} />
            </Box>
          ))}
        </Stack>
      </Card>
    </Box>
  );
}