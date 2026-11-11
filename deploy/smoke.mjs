// Smoke test of the built game. Mode "local": serves the build from disk under a made-up origin with sigouin.net's
// security headers, so the policy is tested before anything is deployed. Mode "live": the real address.
// node live-smoke.mjs local <dist folder> <_headers file>   |   node live-smoke.mjs live https://sigouin.net/portage/
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from '/Users/ls/Claude-Workspace/personal/portage/e2e/node_modules/@playwright/test/index.mjs';
const [mode, target, headersFile, breakIt] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const problems = [];
const offOrigin = [];
page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') problems.push(`${message.type()}: ${message.text()}`); });
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
let base = target;
if (mode === 'local') {
  base = 'https://portage.test/portage/';
  let policy = readFileSync(headersFile, 'utf8').split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:')).trim().slice('Content-Security-Policy:'.length).trim();
  if (breakIt === 'break') policy = policy.replace("script-src 'self'", "script-src 'none'");
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'https://portage.test' || !url.pathname.startsWith('/portage/')) return route.abort();
    const relative = url.pathname.slice('/portage/'.length) || 'index.html';
    const file = join(target, relative);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': policy, 'x-content-type-options': 'nosniff' } });
  });
}
page.on('request', (request) => { if (new URL(request.url()).origin !== new URL(base).origin && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) offOrigin.push(request.url()); });
const canoe = () => page.evaluate(() => { const c = window.portage.session.game.canoe.position; return [c.x, c.z]; });
// 1. The lobby, then New Game by a real click.
await page.goto(base);
await page.waitForFunction(() => window.portage?.worldView?.probe?.().drawingWidth > 0, null, { timeout: 30000 });
// The menu moves a little when its fonts arrive, so wait for them before aiming a click at it.
await page.evaluate(() => document.fonts.ready);
await page.getByText(process.env.SMOKE_CLICK ?? 'New Game', { exact: true }).click();
// The words "save slots" are also in the menu line, so look for the panel itself and ask the session what is open.
const slots = await page.locator('.iw-panel-save_slots').waitFor({ timeout: 10000 }).then(() => 1, () => 0);
const opened = await page.evaluate(() => [...window.portage.session.panels.stack].join(',') || 'none');
// 2. A game at quest 1: hold W, the canoe must move.
await page.goto(`${base}?at=quest1`);
await page.waitForFunction(() => window.portage?.session?.game != null && window.portage.worldView.probe().drawingWidth > 0, null, { timeout: 30000 });
await page.waitForTimeout(1500);
const before = await canoe();
await page.keyboard.down('KeyW'); await page.waitForTimeout(3000); await page.keyboard.up('KeyW');
const after = await canoe();
const moved = Math.hypot(after[0] - before[0], after[1] - before[1]);
const drawing = await page.evaluate(() => { const p = window.portage.worldView.probe(); return `${p.drawingWidth}x${p.drawingHeight}`; });
const fonts = await page.evaluate(() => [...document.fonts].filter((font) => font.status === 'loaded').length);
if (process.argv.includes('--shot')) await page.screenshot({ path: process.argv[process.argv.indexOf('--shot') + 1] });
await browser.close();
console.log(`${mode}: New Game opened ${opened}, canoe moved ${moved.toFixed(1)} m in 3 s, drawing ${drawing}, fonts loaded ${fonts}, off-origin requests ${offOrigin.length}, console problems ${problems.length}`);
for (const problem of problems.slice(0, 5)) console.log(`  ${problem.slice(0, 220)}`);
const ok = slots === 1 && opened === 'save_slots' && moved > 2 && fonts >= 2 && offOrigin.length === 0 && problems.length === 0;
console.log(ok ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(ok ? 0 : 1);
