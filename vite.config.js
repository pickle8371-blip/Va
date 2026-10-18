import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: false, host: 'localhost' },
  preview: { port: 4173, host: 'localhost' },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
