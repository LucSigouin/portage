import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

/** Where the relay runs on this computer (`relay/`, `npm run dev`). The dev server passes `/relay` on to it. */
const LOCAL_RELAY = 'ws://localhost:8791';
const relayProxy = { '/relay': { target: LOCAL_RELAY, ws: true, rewrite: (path: string): string => path.replace(/^\/relay/, '') } };

export default defineConfig(({ command, mode }) => ({
  define: {
    // The one setting that says where the relay is: PORTAGE_RELAY, a `wss://` address or a path on the site's
    // own host (`/portage/relay`). A build made without it has no relay: no crew entries in the lobby and no
    // relay code in the bundle. The dev server points at the relay on this computer.
    // (Read from the environment. The folder named here is this one, so no `.env` file elsewhere is ever opened.)
    __PORTAGE_RELAY__: JSON.stringify(loadEnv(mode, decodeURIComponent(new URL('.', import.meta.url).pathname), 'PORTAGE_').PORTAGE_RELAY
      ?? (command === 'serve' ? '/relay' : '')),
  },
  server: { port: 5220, strictPort: true, proxy: relayProxy },
  preview: { proxy: relayProxy },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    // Show console output from passing tests: the bot test prints its report.
    silent: false,
  },
}));
