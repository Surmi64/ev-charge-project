import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          mui: ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
          charts: ['recharts'],
          date: ['dayjs', '@mui/x-date-pickers', '@mui/x-date-pickers/AdapterDayjs'],
        },
      },
    },
  },
  server: {
    port: 4242,
    proxy: {
      '/api': {
        target: 'http://backend:4646',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      }
    }
  }
})
