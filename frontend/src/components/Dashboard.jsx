import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Grid, 
  Card, 
  Paper,
  CircularProgress,
  useTheme,
  useMediaQuery
} from '@mui/material';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { toast } from 'sonner';

const Dashboard = () => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/dashboard/stats', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        toast.error('Hiba a statisztikák betöltésekor');
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}><CircularProgress /></Box>;
  if (!stats) return <Typography>No data found.</Typography>;

  const StatCard = ({ title, value, unit, color }) => (
    <Card sx={{ p: 3, borderRadius: 4, height: '100%' }}>
      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Typography variant="h4" fontWeight="800" sx={{ color: color }}>
          {value.toLocaleString()}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {unit}
        </Typography>
      </Box>
    </Card>
  );

  return (
    <Box>
      <Typography variant="h4" fontWeight="800" sx={{ mb: 4 }}>
        Dashboard
      </Typography>

      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={4}>
          <StatCard title="Total Energy" value={stats.total_energy_kwh} unit="kWh" color="primary.main" />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard title="Total Cost" value={stats.total_cost_huf} unit="HUF" color="secondary.main" />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard title="Sessions" value={stats.total_sessions} unit="logs" color="success.main" />
        </Grid>
      </Grid>

      <Card sx={{ p: 3, borderRadius: 4 }}>
        <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
          Monthly Spending (HUF)
        </Typography>
        <Box sx={{ width: '100%', height: isMobile ? 250 : 350 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.monthly_stats}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
              <XAxis 
                dataKey="month" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
              />
              <Tooltip 
                cursor={{ fill: 'transparent' }}
                contentStyle={{ 
                  borderRadius: '12px', 
                  backgroundColor: theme.palette.background.paper,
                  border: `1px solid ${theme.palette.divider}`
                }}
              />
              <Bar dataKey="total_cost" radius={[8, 8, 0, 0]}>
                {stats.monthly_stats.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={theme.palette.primary.main} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Card>
    </Box>
  );
};

export default Dashboard;
