import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// No Node typings are installed in this project, so the one Node module needed is asked for by a plain string.
const { execFileSync } = (await import('node:child_process' as string)) as {
  execFileSync(file: string, parts: string[], options: { cwd: URL; stdio: string[] }): { toString(): string };
};

/**
 * The build's stamp, for the performance readout (`?perf=1`): the commit it was built from, that commit's
 * date, whether files had changed since, and whether this is a build or the dev server. 'unknown' without git.
 */
function buildStamp(command: string): string {
  const git = (...parts: string[]): string => {
    try {
      return execFileSync('git', parts, { cwd: new URL('.', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const commit = git('rev-parse', '--short', 'HEAD');
  if (commit === '') return 'unknown';
  const changed = git('status', '--porcelain') !== '';
  return `${commit} (${git('log', '-1', '--format=%cs')})${changed ? ' with uncommitted changes' : ''}, ${command === 'build' ? 'built' : 'dev server'}`;
}

/** Where the relay runs on this computer (`relay/`, `npm run dev`). The dev server passes `/relay` on to it. */
const LOCAL_RELAY = 'ws://localhost:8791';
const relayProxy = { '/relay': { target: LOCAL_RELAY, ws: true, rewrite: (path: string): string => path.replace(/^\/relay/, '') } };

export default defineConfig(({ command, mode }) => ({
  define: {
    __PORTAGE_BUILD__: JSON.stringify(buildStamp(command)),
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
