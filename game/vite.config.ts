import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// No Node typings are installed in this project, so the one Node module needed is asked for by a plain string.
const { execFileSync } = (await import('node:child_process' as string)) as {
  execFileSync(file: string, parts: string[], options: { cwd: URL; stdio: string[] }): { toString(): string };
};

/** One git answer about this checkout. Empty without git. */
function git(...parts: string[]): string {
  try {
    return execFileSync('git', parts, { cwd: new URL('.', import.meta.url), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

/** The release a player sees. The number after it counts itself: one more with every commit. */
const RELEASE = '1.0';

/**
 * The version shown in Settings, so a player can say which game they have: "1.0.185 · 931d4b0". The release, the
 * number of commits the build was made from, and the commit. 'unknown' without git.
 */
function buildVersion(): string {
  const count = git('rev-list', '--count', 'HEAD');
  const commit = git('rev-parse', '--short', 'HEAD');
  return count === '' || commit === '' ? 'unknown' : `${RELEASE}.${count} · ${commit}`;
}

/**
 * The build's stamp, for the performance readout (`?perf=1`): the commit it was built from, that commit's
 * date, whether files had changed since, and whether this is a build or the dev server. 'unknown' without git.
 */
function buildStamp(command: string): string {
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
    __PORTAGE_VERSION__: JSON.stringify(buildVersion()),
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
