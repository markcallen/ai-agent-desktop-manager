import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// All static assets are served under this prefix by Fastify.
// In dev mode Fastify proxies this prefix to the Vite dev server.
// In production Fastify serves web/dist/ under this prefix.
const ASSET_BASE = '/_aadm/desktop-app/';

// When VITE_HMR_CLIENT_PORT is set the Vite dev server is running behind the
// Fastify proxy.  HMR WebSocket traffic is routed through the proxy at
// /_aadm_hmr so the browser only needs to talk to the Fastify port (8899 in
// local Docker).  Without the env var the dev server is accessed directly on
// port 5173 and standard HMR applies.
const hmrClientPort = process.env.VITE_HMR_CLIENT_PORT
  ? parseInt(process.env.VITE_HMR_CLIENT_PORT, 10)
  : undefined;

// When running Vite standalone (not behind the Fastify proxy), forward browser
// log POSTs to the Fastify server so they are received by the /_aadm/logs
// route.  Defaults to port 8899; override with VITE_API_TARGET.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8899';

export default defineConfig({
  base: ASSET_BASE,
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    hmr: {
      path: '/_aadm_hmr',
      ...(hmrClientPort !== undefined ? { clientPort: hmrClientPort } : {})
    },
    proxy: {
      '/_aadm/logs': {
        target: apiTarget,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist'
  }
});
