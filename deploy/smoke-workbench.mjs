// Smoke test of the public workbench page, on a phone-sized screen.
// Mode "local": serves the build from disk under a made-up origin with sigouin.net's security headers, so the
// policy is tested before anything is deployed. Mode "live": the real address.
//   node smoke-workbench.mjs local <dist folder> <_headers file> [break]   |   node smoke-workbench.mjs live https://sigouin.net/portage/
// "break" forbids every script in the local policy: the test must then fail.
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from '/Users/ls/Claude-Workspace/personal/portage/e2e/node_modules/@playwright/test/index.mjs';
const [mode, target, headersFile, breakIt] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
// The page must show every step and every picture the words name: a picture left off stops the deploy.
const words = JSON.parse(readFileSync('/Users/ls/Claude-Workspace/personal/portage/hub/workbench.json', 'utf8'));
const wantSteps = words.steps.length;
const wantPictures = words.steps.reduce((sum, step) => sum + step.pictures.length, 0);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
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
    // Cloudflare Pages serves workbench.html at /portage/workbench.
    const file = join(target, extname(relative) ? relative : `${relative}.html`);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
    return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': policy, 'x-content-type-options': 'nosniff' } });
  });
}
const origin = new URL(base).origin;
page.on('request', (request) => { if (new URL(request.url()).origin !== origin && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) offOrigin.push(request.url()); });

const answer = await page.goto(`${base}workbench`);
const status = answer ? answer.status() : 0;
await page.evaluate(() => document.fonts.ready);
const steps = await page.locator('.step').count();
// Pictures wait until they are near the screen. Ask for all of them now.
const pictures = await page.evaluate(() => {
  const all = [...document.images];
  const loaded = all.map((image) => new Promise((done) => {
    image.loading = 'eager';
    if (image.complete && image.naturalWidth) return done();
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
    setTimeout(done, 15000);
  }));
  return Promise.all(loaded).then(() => ({ count: all.length, broken: all.filter((image) => !image.naturalWidth).map((image) => image.currentSrc || image.src) }));
});
const fonts = await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').length);
const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
// Every link that stays on this site must answer. (Links to other sites are not followed.)
const links = await page.evaluate(async (site) => {
  const hrefs = [...new Set([...document.querySelectorAll('a[href]')].map((link) => link.href).filter((href) => href.startsWith(`${site}/`) && !href.includes('#')))];
  const dead = [];
  for (const href of hrefs) {
    const code = await fetch(href).then((reply) => reply.status, () => 0);
    if (code !== 200) dead.push(`${code} ${href}`);
  }
  return { count: hrefs.length, dead };
}, origin);
// The page's script is served as a file. It puts the jump button away while the run list is on screen.
await page.evaluate(() => document.getElementById('run').scrollIntoView());
const scriptRan = await page.waitForFunction(() => document.querySelector('.to-run').hidden === true, null, { timeout: 5000 }).then(() => true, () => false);
await browser.close();

console.log(`${mode} workbench: status ${status}, ${steps} of ${wantSteps} steps, ${pictures.count} of ${wantPictures} pictures (${pictures.broken.length} broken), fonts loaded ${fonts}, ${links.count} links on this site answer (${links.dead.length} dead), ${sideways} px of sideways scroll, script ran ${scriptRan}, off-origin requests ${offOrigin.length}, console problems ${problems.length}`);
for (const line of [...pictures.broken.map((src) => `broken picture: ${src}`), ...links.dead.map((link) => `dead link: ${link}`), ...offOrigin.map((url) => `off-origin: ${url}`), ...problems]) console.log(`  ${line}`);
const ok = status === 200 && steps === wantSteps && pictures.count === wantPictures && pictures.broken.length === 0 && fonts >= 2
  && links.dead.length === 0 && sideways <= 0 && scriptRan && offOrigin.length === 0 && problems.length === 0;
console.log(ok ? 'WORKBENCH PASS' : 'WORKBENCH FAIL');
process.exit(ok ? 0 : 1);
