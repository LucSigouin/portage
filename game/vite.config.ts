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

export default defineConfig(({ command }) => ({
  define: { __PORTAGE_BUILD__: JSON.stringify(buildStamp(command)) },
  server: { port: 5220, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    // Show console output from passing tests: the bot test prints its report.
    silent: false,
  },
}));
