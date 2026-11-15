// Round pen-far: the upgraded canoe at 4 distances x 2 pitches, under C (`bold`, the live pen) and each candidate,
// then the pixel count of each candidate against C all the way in, and the game's own work per frame at the far low view.
//   node e2e/pen-far.mjs --out <folder>   (starts its own dev server on 5216, kills it at the end)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[process.argv.indexOf('--out') + 1];
mkdirSync(join(out, 'shots'), { recursive: true });
const game = join(dirname(fileURLToPath(import.meta.url)), '..', 'game');
const server = spawn(join(game, 'node_modules', '.bin', 'vite'), ['--port', '5216', '--strictPort'], { cwd: game, stdio: 'ignore' });
const PENS = ['bold', 'soon', 'calm', 'fine'];
const DISTANCES = [4, 12, 24, 28];
const PITCHES = [['default', 0.34], ['low', 0.12]];
const results = { diffs: {}, cost: {} };
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://localhost:5216/')).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const shoot = async (pen, distance, pitch, file) => {
    await page.goto(`http://localhost:5216/?shot=upgraded&pen=${pen}&cam=${distance},${pitch}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.portage, null, { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: file });
  };
  for (const pen of PENS) {
    for (const [pitchName, pitch] of PITCHES) {
      for (const distance of DISTANCES) {
        await shoot(pen, distance, pitch, join(out, 'shots', `${pen}-d${distance}-${pitchName}.png`));
      }
    }
    // the game's own work per frame, held still at the far low view: frame(0), then wait for the card to finish
    const costs = await page.evaluate(async () => {
      const { app } = window.portage;
      const gl = document.querySelector('canvas').getContext('webgl2');
      const px = new Uint8Array(4);
      const times = [];
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        const t = performance.now();
        app.frame(0);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        times.push(performance.now() - t);
      }
      times.sort((a, b) => a - b);
      return { median: times[25], quickest: times[0] };
    });
    results.cost[pen] = costs;
  }
  // a noise baseline: C again, all the way in
  for (const [pitchName, pitch] of PITCHES) await shoot('bold', 4, pitch, join(out, 'shots', `bold-again-d4-${pitchName}.png`));
  // pixel counts against C all the way in
  await page.goto('about:blank');
  const count = async (a, b) => page.evaluate(async ([aData, bData]) => {
    const load = async (data) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    };
    const [x, y] = [await load(aData), await load(bData)];
    let changed = 0;
    for (let i = 0; i < x.length; i += 4) {
      if (Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]) > 24) changed++;
    }
    return changed;
  }, [readFileSync(a).toString('base64'), readFileSync(b).toString('base64')]);
  for (const [pitchName] of PITCHES) {
    const near = join(out, 'shots', `bold-d4-${pitchName}.png`);
    results.diffs[`bold-again-${pitchName}`] = await count(near, join(out, 'shots', `bold-again-d4-${pitchName}.png`));
    for (const pen of PENS.slice(1)) results.diffs[`${pen}-${pitchName}`] = await count(near, join(out, 'shots', `${pen}-d4-${pitchName}.png`));
  }
  await browser.close();
} finally {
  server.kill();
}
writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
