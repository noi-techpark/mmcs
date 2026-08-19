import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// https://vite.dev/config/
const backendHost = process.env.BACKEND_HOST ?? 'localhost:8080'

// MapLibre GL builds its worker's URL at runtime as a sibling of its own
// script's import.meta.url (see maplibre-gl's getWorkerUrl), not via a
// static import — so Vite's bundler never sees it as a dependency and
// won't emit it on its own. Dev mode happens to work anyway because Vite's
// dev server resolves that relative request straight from node_modules;
// only the production build needs this copied in by hand.
function copyMaplibreWorker(): Plugin {
  return {
    name: 'copy-maplibre-worker',
    closeBundle() {
      const src = resolve(import.meta.dirname, 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')
      const dest = resolve(import.meta.dirname, 'dist/assets/maplibre-gl-worker.mjs')
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
    },
  }
}

export default defineConfig({
  plugins: [react(), copyMaplibreWorker()],
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
