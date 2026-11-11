import { defineConfig } from 'vitest/config';

export default defineConfig({
  server: { port: 5220, strictPort: true },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
    // Show console output from passing tests: the bot test prints its report.
    silent: false,
  },
});
