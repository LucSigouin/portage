import { defineConfig } from 'vite';

// three.js is one chunk on purpose: nothing here loads lazily.
export default defineConfig({ build: { chunkSizeWarningLimit: 900 } });
