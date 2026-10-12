import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const apiTarget = process.env.API_TARGET ?? 'http://127.0.0.1:8200'

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  // In production (Electron), assets are loaded via file:// so paths must be relative.
  // In dev, '/' is correct so the Vite proxy can intercept /api and /health.
  base: command === 'build' ? './' : '/',
  server: {
    port: 5176,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
    },
  },
  build: {
    outDir: 'dist',
  },
}))
