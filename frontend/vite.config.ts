import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
const backendHost = process.env.BACKEND_HOST ?? 'localhost:8080'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  server: {
    host: true,
    proxy: {
      '/api': `http://${backendHost}`,
      '/ws': {
        target: `ws://${backendHost}`,
        ws: true,
      },
    },
  },
})
