// Smoke test of the published asset viewer.
// Mode "local": serves the build from disk under a made-up origin with sigouin.net's security headers, so the
// policy is tested before anything is deployed. Mode "live": the real address.
//   node smoke-assets.mjs local <dist folder> <_headers file> [break]   |   node smoke-assets.mjs live https://sigouin.net/portage-assets/
// "break" forbids every script in the local policy: the test must then fail.
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from '/Users/ls/Claude-Workspace/personal/portage/e2e/node_modules/@playwright/test/index.mjs';
const [mode, target, headersFile, breakIt] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
const offOrigin = [];
page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`); });
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
let base = target;
if (mode === 'local') {
  base = 'https://portage.test/portage-assets/';
  let policy = readFileSync(headersFile, 'utf8').split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
  if (breakIt === 'break') policy = policy.replace("script-src 'self'", "script-src 'none'");
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://portage.test' || !url.pathname.startsWith('/portage-assets/')) return route.abort();
    const relative = url.pathname.slice('/portage-assets/'.length) || 'index.html';
    const file = join(target, relative);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': policy, 'x-content-type-options': 'nosniff' } });
  });
}
const origin = new URL(base).origin;
page.on('request', (request) => { if (new URL(request.url()).origin !== origin && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) offOrigin.push(request.url()); });

const answer = await page.goto(base);
const status = answer ? answer.status() : 0;
// The page draws its first thing by itself. Wait for a drawn frame.
const drew = await page.waitForFunction(() => window.viewer?.probe().frames > 0, null, { timeout: 30000 }).then(() => true, () => false);
const first = drew ? await page.evaluate(() => window.viewer.probe()) : { thing: '', triangles: 0, failure: 'the page never drew a frame' };
const things = Number((await page.locator('.vw-count').textContent().catch(() => '')).match(/\d+/)?.[0] ?? 0);
// Pick another thing by a real click, and wait for it to be drawn.
let second = { thing: '', triangles: 0, failure: 'not opened' };
if (drew) {
  await page.locator('.vw-item:not([hidden])').nth(30).click();
  await page.waitForFunction((before) => { const now = window.viewer.probe(); return now.thing !== before.thing && now.frames > before.frames; }, first, { timeout: 30000 }).catch(() => {});
  second = await page.evaluate(() => window.viewer.probe());
}
// The stage must hold a picture, not one flat colour.
const colours = drew ? await page.evaluate(() => {
  const stage = document.querySelector('.vw-stage canvas') ?? document.querySelector('canvas');
  const copy = document.createElement('canvas');
  copy.width = 160; copy.height = 120;
  const pen = copy.getContext('2d');
  pen.drawImage(stage, 0, 0, 160, 120);
  const data = pen.getImageData(0, 0, 160, 120).data;
  const seen = new Set();
  for (let at = 0; at < data.length; at += 4) seen.add((data[at] >> 3) << 10 | (data[at + 1] >> 3) << 5 | data[at + 2] >> 3);
  return seen.size;
}) : 0;
// A published copy stands alone: its own front page, no dev-only tools, game screens in the live game.
const links = await page.evaluate(() => [...document.querySelectorAll('.vw-top a[href], .vw-tools a[href], header a[href], nav a[href]')].map((link) => link.getAttribute('href')));
const unique = [...new Set(links)];
const screens = unique.filter((href) => href.startsWith('/portage/?shot='));
const devOnly = unique.filter((href) => href.includes('audio-lab') || href.includes('perf=1') || href.startsWith('/?shot=') || href === '/viewer.html');
let deadScreens = 0;
if (mode === 'live') {
  for (const href of screens.slice(0, 3)) if ((await page.evaluate((address) => fetch(address).then((reply) => reply.status, () => 0), href)) !== 200) deadScreens += 1;
}
await browser.close();

console.log(`${mode} assets: status ${status}, ${things} things, drew "${first.thing}" (${first.triangles} triangles), then "${second.thing}" (${second.triangles} triangles), ${colours} colours on the stage, ${screens.length} screen links to the live game (${deadScreens} dead), dev-only links ${devOnly.length}, off-origin requests ${offOrigin.length}, console problems ${problems.length}`);
for (const line of [...devOnly.map((href) => `dev-only link: ${href}`), ...offOrigin.map((url) => `off-origin: ${url}`), ...problems, ...[first.failure, second.failure].filter(Boolean).map((failure) => `viewer failure: ${failure}`)]) console.log(`  ${line}`);
const ok = status === 200 && drew && things >= 100 && first.thing !== '' && !first.failure && second.thing !== '' && second.thing !== first.thing && !second.failure
  && colours >= 8 && screens.length >= 10 && deadScreens === 0 && devOnly.length === 0 && offOrigin.length === 0 && problems.length === 0;
console.log(ok ? 'ASSETS PASS' : 'ASSETS FAIL');
process.exit(ok ? 0 : 1);
