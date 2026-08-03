import React, { useEffect, useState } from 'react';
import {
  Box,
  Card,
  Divider,
  Paper,
  Skeleton,
  Stack,
} from '@mui/material';

/**
 * Placeholders that mirror the real layouts.
 *
 * These are about layout stability, not decoration: if a skeleton has a different
 * shape from the content that replaces it, everything below jumps the moment data
 * arrives. Each block below matches its page card for card and height for height, so
 * keep them in step when a page changes.
 */

/** Title + subtitle on the left, a control on the right. Every page starts this way. */
function PageHeaderSkeleton({ actionWidth = 132 }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="flex-start"
      flexWrap="wrap" useFlexGap sx={{ mb: 1 }}>
      <Box>
        <Skeleton variant="text" width={200} height={54} />
        <Skeleton variant="text" width={280} height={24} />
      </Box>
      <Skeleton variant="rounded" width={actionWidth} height={38} sx={{ mt: 1 }} />
    </Stack>
  );
}

/** One labelled figure with a coloured rule down its left edge. */
function FigureSkeleton() {
  return (
    <Box sx={{ borderLeft: '3px solid', borderColor: 'divider', pl: 1.5 }}>
      <Skeleton variant="text" width="70%" height={20} />
      <Skeleton variant="text" width="55%" height={32} />
      <Skeleton variant="text" width="80%" height={16} />
    </Box>
  );
}

/** A name on the left, a value on the right, a progress bar underneath. */
function BarRowSkeleton() {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Skeleton variant="text" width={140} height={20} />
        <Skeleton variant="text" width={110} height={20} />
      </Stack>
      <Skeleton variant="rounded" height={10} />
    </Box>
  );
}

/** Two stacked lines on the left, a value on the right. */
function ListRowSkeleton() {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ py: 1.25 }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Skeleton variant="text" width="55%" height={20} />
        <Skeleton variant="text" width="38%" height={16} />
      </Box>
      <Skeleton variant="text" width={90} height={20} />
    </Stack>
  );
}

export function DashboardSkeleton() {
  return (
    <Box className="section-shell stagger">
      <PageHeaderSkeleton actionWidth={132} />

      {/* Headline figure card: label, big number, divider, three figures. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Skeleton variant="text" width={130} height={20} />
        <Skeleton variant="text" width={280} height={60} sx={{ mb: 2 }} />
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
          {[0, 1, 2].map((i) => <FigureSkeleton key={i} />)}
        </Box>
      </Card>

      {/* Trend chart, same height as the real one. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Skeleton variant="text" width={160} height={30} />
          <Skeleton variant="rounded" width={104} height={30} />
        </Stack>
        <Skeleton variant="rounded" sx={{ height: { xs: 220, sm: 300 } }} />
      </Card>

      {/* Recent | Coming up. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        {[0, 1].map((card) => (
          <Card key={card} sx={{ p: 3, borderRadius: 4 }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
              <Skeleton variant="text" width={120} height={30} />
              <Skeleton variant="rounded" width={104} height={30} />
            </Stack>
            <Stack divider={<Divider />}>
              {[0, 1, 2, 3, 4].map((row) => <ListRowSkeleton key={row} />)}
            </Stack>
          </Card>
        ))}
      </Box>

      {/* Cost by vehicle. */}
      <Card sx={{ p: 3, borderRadius: 4 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
          <Skeleton variant="text" width={200} height={30} />
          <Skeleton variant="rounded" width={104} height={30} />
        </Stack>
        <Stack spacing={2}>
          {[0, 1, 2].map((row) => <BarRowSkeleton key={row} />)}
        </Stack>
      </Card>
    </Box>
  );
}

export function AnalyticsSkeleton() {
  return (
    <Box className="section-shell stagger">
      <PageHeaderSkeleton actionWidth={260} />

      {/* Four headline figures. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2 }}>
          {[0, 1, 2, 3].map((i) => <FigureSkeleton key={i} />)}
        </Box>
      </Card>

      {/* Cost over time. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Skeleton variant="text" width={180} height={30} />
        <Skeleton variant="text" width="70%" height={20} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" sx={{ height: { xs: 240, sm: 320 } }} />
      </Card>

      {/* Efficiency ranking. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width={130} height={30} />
            <Skeleton variant="text" width="80%" height={20} />
          </Box>
          <Skeleton variant="rounded" width={280} height={34} />
        </Stack>
        <Stack spacing={2}>
          {[0, 1, 2].map((row) => <BarRowSkeleton key={row} />)}
        </Stack>
      </Card>

      {/* All figures table. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Skeleton variant="text" width={140} height={30} />
        <Skeleton variant="text" width="45%" height={20} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={34} sx={{ mb: 1 }} />
        {[0, 1, 2].map((row) => <Skeleton key={row} variant="text" height={38} />)}
      </Card>

      {/* Split | categories. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
        <Card sx={{ p: 3, borderRadius: 4 }}>
          <Skeleton variant="text" width={200} height={30} sx={{ mb: 2 }} />
          <Stack spacing={2.5}>
            {[0, 1].map((row) => <BarRowSkeleton key={row} />)}
          </Stack>
        </Card>
        <Card sx={{ p: 3, borderRadius: 4 }}>
          <Skeleton variant="text" width={160} height={30} sx={{ mb: 2 }} />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
            <Skeleton variant="circular" width={168} height={168} sx={{ flexShrink: 0 }} />
            <Stack spacing={0.75} sx={{ flex: 1, width: '100%' }}>
              {[0, 1, 2, 3, 4].map((row) => <Skeleton key={row} variant="text" height={22} />)}
            </Stack>
          </Stack>
        </Card>
      </Box>

      {/* Providers: two rings side by side. */}
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Skeleton variant="text" width={120} height={30} />
        <Skeleton variant="text" width="55%" height={20} sx={{ mb: 2 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
          {[0, 1].map((ring) => (
            <Box key={ring}>
              <Skeleton variant="text" width={80} height={22} sx={{ mb: 1 }} />
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                <Skeleton variant="circular" width={168} height={168} sx={{ flexShrink: 0 }} />
                <Stack spacing={0.75} sx={{ flex: 1, width: '100%' }}>
                  {[0, 1, 2, 3, 4].map((row) => <Skeleton key={row} variant="text" height={22} />)}
                </Stack>
              </Stack>
            </Box>
          ))}
        </Box>
      </Card>

      {/* Single vehicle drilldown. */}
      <Card sx={{ p: 3, borderRadius: 4 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Skeleton variant="text" width={140} height={30} />
            <Skeleton variant="text" width="60%" height={20} />
          </Box>
          <Skeleton variant="rounded" width={200} height={40} />
        </Stack>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 2, mb: 2 }}>
          {[0, 1, 2, 3].map((i) => <FigureSkeleton key={i} />)}
        </Box>
        <Divider sx={{ mb: 2 }} />
        <Skeleton variant="rounded" sx={{ height: { xs: 200, sm: 260 } }} />
      </Card>
    </Box>
  );
}

/** Records → Ledger. Only the list: the page keeps its header, tabs and filters
 *  mounted while loading, so repeating them here would double them up. */
export function TimelineSectionSkeleton() {
  return (
    <Box>
      <Paper sx={{ borderRadius: 4, px: 2 }}>
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <Box key={row}>
            {row > 0 ? <Divider /> : null}
            <ListRowSkeleton />
          </Box>
        ))}
      </Paper>
    </Box>
  );
}

/** Vehicles and User management: a full page swap ending in a table. */
export function TableSectionSkeleton({ rows = 5 }) {
  return (
    <Box className="section-shell stagger">
      <PageHeaderSkeleton actionWidth={150} />
      <Paper sx={{ borderRadius: 4, overflow: 'hidden' }}>
        <Box sx={{ px: 2, py: 1.5 }}>
          <Skeleton variant="text" height={28} />
        </Box>
        <Divider />
        {Array.from({ length: rows }).map((_, index) => (
          <Box key={index}>
            {index > 0 ? <Divider /> : null}
            <Box sx={{ px: 2, py: 1.75 }}>
              <Skeleton variant="text" width="35%" height={24} />
              <Skeleton variant="text" width="55%" height={18} />
            </Box>
          </Box>
        ))}
      </Paper>
    </Box>
  );
}

/** The Recurring tab: a header row and a stack of cards. */
export function CardListSkeleton({ rows = 3 }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Skeleton variant="text" width={320} height={22} />
        <Skeleton variant="rounded" width={150} height={38} />
      </Stack>
      <Stack spacing={1.5}>
        {Array.from({ length: rows }).map((_, index) => (
          <Card key={index} sx={{ p: 2, borderRadius: 3 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between"
              spacing={1.5} alignItems={{ sm: 'center' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Skeleton variant="text" width="45%" height={24} />
                <Skeleton variant="text" width="65%" height={20} />
              </Box>
              <Stack direction="row" spacing={1}>
                <Skeleton variant="rounded" width={72} height={24} />
                {[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="circular" width={30} height={30} />)}
              </Stack>
            </Stack>
          </Card>
        ))}
      </Stack>
    </Box>
  );
}

/**
 * Shown while a route's JavaScript chunk downloads, before that page can render its
 * own skeleton. It deliberately echoes the shape every page shares — header, a tall
 * card, then a pair — so the hand-off is a swap rather than a reflow. The old
 * fallback was a centred spinner in a 50vh box, which meant two visible jumps per
 * navigation instead of none.
 */
export function PageFallbackSkeleton() {
  // A route chunk usually arrives in a few tens of milliseconds, and a placeholder
  // that appears and disappears inside that window just flickers. Hold off briefly
  // and most navigations never show anything at all.
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 220);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <Box className="section-shell stagger">
      <PageHeaderSkeleton actionWidth={132} />
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Skeleton variant="text" width={130} height={20} />
        <Skeleton variant="text" width={280} height={60} sx={{ mb: 2 }} />
        <Divider sx={{ mb: 2 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 2 }}>
          {[0, 1, 2].map((i) => <FigureSkeleton key={i} />)}
        </Box>
      </Card>
      <Card sx={{ p: 3, borderRadius: 4, mb: 2 }}>
        <Skeleton variant="text" width={160} height={30} sx={{ mb: 1.5 }} />
        <Skeleton variant="rounded" sx={{ height: { xs: 220, sm: 300 } }} />
      </Card>
    </Box>
  );
}
