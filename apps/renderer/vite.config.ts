import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const hotReloadEnabled = process.env.PRODUCER_PLAYER_HOT_RELOAD === 'true';

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    hmr: hotReloadEnabled,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
