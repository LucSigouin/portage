/**
 * `npm run bot`: play the main line headless and print the report.
 * Optional arguments: a seed, then `-v` for a line per action.
 */
import { BOT_SEED, formatReport, runBot } from './bot.ts';

declare const process: { argv: string[]; exitCode?: number };

const seedArgument = process.argv.slice(2).find((argument) => /^\d+$/.test(argument));
const verbose = process.argv.includes('-v');
const startedAt = performance.now();
const report = runBot({
  seed: seedArgument ? Number(seedArgument) : BOT_SEED,
  log: verbose ? (line) => console.log(line) : undefined,
});
console.log(formatReport(report));
console.log(`Wall clock: ${((performance.now() - startedAt) / 1000).toFixed(1)} s`);
if (!report.completed || report.fails > 0) process.exitCode = 1;
