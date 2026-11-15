// Round pen-far, run 2: Luc's middle band (level camera) under C and calm, and a ring of yaws and pitches round the
// canoe under C to hunt a missing or pixelated outline.
//   node e2e/pen-far2.mjs --out <folder>   (starts its own dev server on 5216, kills it at the end)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(join(out, 'shots2'), { recursive: true });
const game = join(dirname(fileURLToPath(import.meta.url)), '..', 'game');
const server = spawn(join(game, 'node_modules', '.bin', 'vite'), ['--port', '5216', '--strictPort'], { cwd: game, stdio: 'ignore' });
const jobs = [];
// the band: level camera, side on (yaw 1.57 off the bow, as Luc's mid picture), 6 distances, C and calm
for (const pen of ['bold', 'calm']) for (const distance of [4, 7, 10, 14, 20, 28]) jobs.push([pen, `${distance},0.07,1.57`, `${pen}-band-d${distance}.png`]);
// the ring: C at 10 m, four yaws x three pitches
for (const yaw of [0, 1.57, 3.14, 4.71]) for (const pitch of [0.07, 0.34, 0.8]) jobs.push(['bold', `10,${pitch},${yaw}`, `bold-ring-y${yaw}-p${pitch}.png`]);
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://localhost:5216/')).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const [pen, cam, file] of jobs) {
    await page.goto(`http://localhost:5216/?shot=upgraded&pen=${pen}&cam=${cam}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.portage, null, { timeout: 30000 });
    await page.waitForTimeout(2200);
    await page.screenshot({ path: join(out, 'shots2', file) });
    console.log('saved', file);
  }
  await browser.close();
} finally {
  server.kill();
}
