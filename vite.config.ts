import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const port = Number(env.VITE_PORT || 3001);
  const backendUrl = env.VITE_BACKEND_URL || 'http://127.0.0.1:8000';

  return {
    plugins: [react(), tailwindcss()],
    optimizeDeps: {noDiscovery: true},
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      port,
      strictPort: true,
      proxy: {
        '/api': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/sanctum': {
          target: backendUrl,
          changeOrigin: true,
        },
        '/up': {
          target: backendUrl,
          changeOrigin: true,
        },
      },
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
