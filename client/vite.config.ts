import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

// The client is a static Vite + React app that talks to Supabase directly (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
// from the repo-root .env). `npm run build` writes client/dist — host it on any static host.
export default defineConfig(() => ({
  root: here,
  envDir: path.resolve(here, '..'),
  plugins: [react(), tailwindcss()],
  publicDir: path.resolve(here, '..', 'public'), // img/ + assets/ are copied next to the bundle
  build: {
    outDir: path.resolve(here, 'dist'),
    emptyOutDir: true,
    // Keep CSS compatible with older mobile browsers: without this the minifier rewrites media
    // queries to range syntax ((width<=760px)), which pre-16.4 Safari/webviews ignore entirely —
    // every phone style silently drops and the desktop layout renders on mobile.
    cssTarget: 'safari14',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Split heavy vendor libs into their own long-cache chunks so the app bundle stays small.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (id.includes('@heroui')) return 'heroui';
          return 'vendor';
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 8000 },
}));
