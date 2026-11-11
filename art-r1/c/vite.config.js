import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5213, strictPort: true },
  build: { chunkSizeWarningLimit: 1600, target: 'es2022' },
});
