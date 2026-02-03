import React, { useState, useEffect } from 'react';
import {
  Box, Card, CardContent, Typography, Grid, 
  CircularProgress, IconButton, Chip, Divider, Stack
} from '@mui/material';
import { Edit, EvStation, AccessTime, LocalAtm, DirectionsCar } from '@mui/icons-material';
import dayjs from 'dayjs';

const PRIMARY_API = import.meta.env.VITE_API_URL || 'http://100.104.111.43:5555';
const FALLBACK_API = 'http://192.168.1.100:5555';

const SessionCard = ({ session, onEdit }) => {
  const startTime = session.start_time ? dayjs(session.start_time) : null;
  const endTime = session.end_time ? dayjs(session.end_time) : null;
  const isDC = session.ac_or_dc?.toUpperCase() === 'DC';

  return (
    <Card sx={{ mb: 2, borderRadius: 2, boxShadow: 2 }}>
      <CardContent sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" mb={1}>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              {startTime ? startTime.format('YYYY.MM.DD HH:mm') : '?'} 
              {endTime ? ` → ${endTime.format('HH:mm')}` : ''}
            </Typography>
            <Typography variant="h6" component="div" sx={{ fontWeight: 'bold', color: '#00e676' }}>
              {session.kwh || 0} <small style={{ fontSize: '0.6em', opacity: 0.8 }}>kWh</small>
            </Typography>
          </Box>
          <Stack alignItems="flex-end">
            <Stack direction="row" spacing={1} mb={1}>
              <Typography variant="caption" sx={{ alignSelf: 'center', opacity: 0.7 }}>
                {session.kw ? `${session.kw}kW` : ''}
              </Typography>
              <Chip 
                label={session.ac_or_dc || 'AC'} 
                color={isDC ? "error" : "success"} 
                size="small" 
                variant="filled"
                sx={{ fontWeight: 'bold', height: 20, fontSize: '0.65rem' }}
              />
            </Stack>
            <Typography variant="h6" color="secondary.main" sx={{ fontWeight: 'bold' }}>
              {Math.round(session.cost_huf || 0).toLocaleString()} <small style={{ fontSize: '0.6em' }}>{session.currency || 'HUF'}</small>
            </Typography>
          </Stack>
        </Stack>

        <Divider sx={{ my: 1, borderColor: 'rgba(255,255,255,0.05)' }} />

        <Grid container spacing={1} mt={0.5}>
          <Grid size={{ xs: 12 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {session.provider || 'Unknown'} • {session.city || ''}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {[session.location_detail, session.notes].filter(Boolean).join(' • ')}
            </Typography>
          </Grid>
        </Grid>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1 }}>
          <IconButton size="small" onClick={() => onEdit(session)}>
            <Edit fontSize="small" />
          </IconButton>
        </Box>
      </CardContent>
    </Card>
  );
};

const ListChargingSessions = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeApi, setActiveApi] = useState(PRIMARY_API);

  useEffect(() => {
    const resolveAndFetch = async () => {
      let url = PRIMARY_API;
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 2000);
        await fetch(`${PRIMARY_API}/health`, { method: 'HEAD', signal: controller.signal });
      } catch (e) {
        console.warn("Primary API unreachable, using fallback.");
        url = FALLBACK_API;
      }
      
      setActiveApi(url);
      fetch(`${url}/charging_sessions`)
        .then(res => res.json())
        .then(data => {
          setSessions(data);
          setLoading(false);
        })
        .catch(err => {
          console.error(err);
          setLoading(false);
        });
    };
    resolveAndFetch();
  }, []);

  if (loading) return (
    <Box display="flex" justifyContent="center" p={5}>
      <CircularProgress />
    </Box>
  );

  return (
    <Box sx={{ pb: 2 }}>
      <Typography variant="h5" sx={{ mb: 2, fontWeight: 'bold', px: 1 }}>
        History
      </Typography>
      {sessions.length === 0 ? (
        <Typography variant="body1" sx={{ textAlign: 'center', mt: 4, color: 'text.secondary' }}>
          No charging sessions yet.
        </Typography>
      ) : (
        sessions.map((s) => (
          <SessionCard key={s.id} session={s} onEdit={(s) => alert('Edit is coming next...')} />
        ))
      )}
    </Box>
  );
};

export default ListChargingSessions;
