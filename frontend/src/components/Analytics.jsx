import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Grid, 
  Card, 
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
  PieChart,
  Pie,
  Cell,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import { toast } from 'sonner';

const Analytics = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const COLORS = ['#00F5FF', '#FF00E5', '#32CD32', '#FFA500', '#8A2BE2'];

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/analytics/summary', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const result = await res.json();
          setData(result);
        }
      } catch (err) {
        toast.error('Hiba az analitika betöltésekor');
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}><CircularProgress /></Box>;
  if (!data) return <Typography>No data available.</Typography>;

  return (
    <Box>
      <Typography variant="h4" fontWeight="800" sx={{ mb: 4 }}>
        Analytics
      </Typography>

      <Grid container spacing={3}>
        {/* Heti Energia Trend */}
        <Grid item xs={12}>
          <Card sx={{ p: 3, borderRadius: 4 }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Energy Consumption Trend (Last 8 Weeks)
            </Typography>
            <Box sx={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <AreaChart data={data.weekly_trend}>
                  <defs>
                    <linearGradient id="colorEnergy" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={theme.palette.primary.main} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={theme.palette.primary.main} stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme.palette.divider} />
                  <XAxis 
                    dataKey="week" 
                    tickFormatter={(val) => new Date(val).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    tick={{ fontSize: 12 }}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', backgroundColor: theme.palette.background.paper }}
                    labelFormatter={(val) => new Date(val).toLocaleDateString()}
                  />
                  <Area type="monotone" dataKey="energy" stroke={theme.palette.primary.main} fillOpacity={1} fill="url(#colorEnergy)" />
                </AreaChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Grid>

        {/* Energia megoszlás járművenként */}
        <Grid item xs={12} md={6}>
          <Card sx={{ p: 3, borderRadius: 4, height: '100%' }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Energy by Vehicle (kWh)
            </Typography>
            <Box sx={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={data.vehicle_stats}
                    dataKey="total_energy"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {data.vehicle_stats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Grid>

        {/* Költség megoszlás járművenként */}
        <Grid item xs={12} md={6}>
          <Card sx={{ p: 3, borderRadius: 4, height: '100%' }}>
            <Typography variant="h6" fontWeight="700" sx={{ mb: 3 }}>
              Cost per Vehicle (HUF)
            </Typography>
            <Box sx={{ width: '100%', height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={data.vehicle_stats} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={theme.palette.divider} />
                  <XAxis type="number" hide />
                  <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="total_cost" fill={theme.palette.secondary.main} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Grid>

        {/* Hatékonysági kártya */}
        <Grid item xs={12} sm={6}>
          <Card sx={{ p: 3, borderRadius: 4, bgcolor: 'rgba(0, 245, 255, 0.05)', border: '1px solid rgba(0, 245, 255, 0.1)' }}>
            <Typography variant="subtitle2" color="primary" gutterBottom>
              Average Charging Efficiency
            </Typography>
            <Typography variant="h3" fontWeight="800">
              {data.avg_cost_per_kwh ? Math.round(data.avg_cost_per_kwh) : 0}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              HUF / kWh (Network Average)
            </Typography>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Analytics;
