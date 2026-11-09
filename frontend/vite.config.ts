import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    // Dev: proxy API calls to the backend so cookies stay same-origin
    proxy: { '/api': { target: process.env.VITE_API_TARGET ?? 'http://localhost:8000', changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          mantine: ['@mantine/core', '@mantine/hooks', '@mantine/notifications', '@mantine/modals', '@mantine/form'],
          charts: ['@mantine/charts', 'recharts'],
        },
      },
    },
  },
});
