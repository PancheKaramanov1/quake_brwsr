import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => ({
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // Production must not ship source maps to public clients.
    sourcemap: mode !== 'production',
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
  },
}))
