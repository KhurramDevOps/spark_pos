import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy API calls to the Express backend during development, so the
    // frontend can call /api/* with no CORS setup. Backend defaults to :5000.
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      },
    },
  },
})
