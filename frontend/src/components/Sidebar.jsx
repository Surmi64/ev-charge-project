import React, { useState } from 'react';
import {
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  IconButton,
  Divider,
} from '@mui/material';
import { Menu, Upload, ListAlt, HelpOutline } from '@mui/icons-material';

const Sidebar = ({ setCurrentPage }) => {
  const [open, setOpen] = useState(true);

  const toggleSidebar = () => setOpen(!open);

  return (
    <Drawer
      variant="permanent"
      anchor="left"
      sx={{
        width: open ? 220 : 60,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: open ? 220 : 60,
          boxSizing: 'border-box',
          backgroundColor: '#1976d2',
          color: '#fff',
          paddingTop: 2,
          transition: 'width 0.3s',
          overflowX: 'hidden',
        },
      }}
    >
      <List>
        <ListItemButton onClick={toggleSidebar}>
          <ListItemIcon>
            <Menu sx={{ color: '#fff' }} />
          </ListItemIcon>
          {open && <ListItemText primary="Menu" sx={{ color: '#fff' }} />}
        </ListItemButton>

        <Divider sx={{ bgcolor: 'rgba(255,255,255,0.3)' }} />

        <ListItemButton onClick={() => setCurrentPage('upload')}>
          <ListItemIcon>
            <Upload sx={{ color: '#fff' }} />
          </ListItemIcon>
          {open && (
            <ListItemText primary="Upload charging" sx={{ color: '#fff' }} />
          )}
        </ListItemButton>

        <ListItemButton onClick={() => setCurrentPage('list')}>
          <ListItemIcon>
            <ListAlt sx={{ color: '#fff' }} />
          </ListItemIcon>
          {open && (
            <ListItemText primary="Charging history" sx={{ color: '#fff' }} />
          )}
        </ListItemButton>

        <ListItemButton disabled>
          <ListItemIcon>
            <HelpOutline sx={{ color: '#fff' }} />
          </ListItemIcon>
          {open && (
            <ListItemText primary="Undefined" sx={{ color: '#fff' }} />
          )}
        </ListItemButton>
      </List>
    </Drawer>
  );
};

export default Sidebar;
