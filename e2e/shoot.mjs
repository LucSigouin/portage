// Headless screenshot of a running dev server, with real key presses if asked.
//
//   node shoot.mjs --url "http://localhost:5220/?shot=play" --out /abs/path/file.png
//     [--width 1920] [--height 1080]   viewport, exact pixels
//     [--wait 1500]                    milliseconds to let the scene settle
//     [--click "New Game,Settings"]    click each visible text in order, before any keys
//     [--keys "KeyW:2000,KeyD:600"]    hold each key (KeyboardEvent.code) for that many ms, in order
//     [--gpu]                          render on the real graphics card, not the software fallback
//     [--strict]                       exit 2 if the page logged an error or warning, or left its origin
//
// Prints every console error, warning, page error, failed request and off-origin request.
// Headless only. It never opens a window.
import { chromium } from '@playwright/test';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const url = arg('url');
const out = arg('out');
if (!url || !out) {
  console.error('Usage: node shoot.mjs --url <url> --out <file.png> [--width N] [--height N] [--wait ms] [--keys "KeyW:2000"] [--gpu] [--strict]');
  process.exit(1);
}

const browser = await chromium.launch({
  headless: true,
  args: argv.includes('--gpu') ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [],
});
const page = await browser.newPage({
  viewport: { width: Number(arg('width', 1920)), height: Number(arg('height', 1080)) },
});

const origin = new URL(url).origin;
const problems = [];
const driverNotes = new Set();
page.on('console', (message) => {
  if (message.type() !== 'error' && message.type() !== 'warning') return;
  // The graphics driver's own performance chatter is not a page fault. Print it once, never fail on it.
  if (message.text().includes('GL Driver Message')) driverNotes.add(message.text().replace(/^\[[^\]]*\]/, '').replace(/ \(this message will no longer repeat\)$/, ''));
  else problems.push(`${message.type()}: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
page.on('request', (request) => {
  const target = request.url();
  if (!target.startsWith(origin) && !target.startsWith('data:') && !target.startsWith('blob:')) {
    problems.push(`off-origin request: ${target}`);
  }
});

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(arg('wait', 1500)));
for (const label of (arg('click', '') ?? '').split(',').filter(Boolean)) {
  await page.getByText(label, { exact: true }).first().click();
  await page.waitForTimeout(600);
}
for (const hold of (arg('keys', '') ?? '').split(',').filter(Boolean)) {
  const [code, milliseconds] = hold.split(':');
  await page.keyboard.down(code);
  await page.waitForTimeout(Number(milliseconds) || 100);
  await page.keyboard.up(code);
}
await page.screenshot({ path: out });
await browser.close();

console.log(`saved ${out}`);
for (const note of driverNotes) console.log(`driver note: ${note}`);
console.log(problems.length ? problems.join('\n') : 'console clean, no off-origin requests');
process.exit(problems.length && argv.includes('--strict') ? 2 : 0);
