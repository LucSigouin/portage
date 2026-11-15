// Round pen-far, run 4: does calm-keel over-ink the world's shores, and does calm-hull leave them as bold has them?
// All shots 1600x900, ladder pinned (&rung=0&hold=1), held still.
//   1. shores: an island shore (?shot=island), a second shore (?shot=dialogue) and a rock at the beacon (?shot=beacon),
//      at 4 m and 12 m, under bold, calm, calm-keel, calm-hull. Pixels changed against bold outside every hero window.
//   2. the canoe in the middle band (?shot=upgraded, 10 m, level, side on) under the four, cropped to its hero box.
//   3. the canoe all the way in (4 m, level, side on) under bold, calm, calm-hull, with a 300% crop of its waterline.
//   node e2e/pen-far4.mjs --out <folder>   (starts its own dev server on 5216, kills it at the end)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[process.argv.indexOf('--out') + 1];
const dir = join(out, 'shots4');
mkdirSync(dir, { recursive: true });
const game = join(dirname(fileURLToPath(import.meta.url)), '..', 'game');
const server = spawn(join(game, 'node_modules', '.bin', 'vite'), ['--port', '5216', '--strictPort'], { cwd: game, stdio: 'ignore' });
const results = { shores: [], band: [], near: [] };
const PENS = ['bold', 'calm', 'calm-keel', 'calm-hull'];
const probeOf = (page) => page.evaluate(() => {
  const p = window.portage.worldView.probe();
  return { rung: p.rung, canvas: [p.canvasWidth, p.canvasHeight], windows: p.hero.windows, pen: p.hero.pen };
});
async function load(page, shot, query) {
  await page.goto(`http://localhost:5216/?shot=${shot}&${query}&rung=0&hold=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.portage && window.portage.worldView, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
}
const read = (f) => 'data:image/png;base64,' + readFileSync(join(dir, f)).toString('base64');
async function crop(blank, file, r, outFile, scale) {
  const png = await blank.evaluate(async ([data, r, s]) => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = r.w * s; canvas.height = r.h * s;
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
    context.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w * s, r.h * s);
    return canvas.toDataURL('image/png');
  }, [read(file), r, scale]);
  writeFileSync(join(dir, outFile), Buffer.from(png.split(',')[1], 'base64'));
}
// Changed pixels between two whole shots, leaving out the given boxes (image pixels from the top left).
async function changed(blank, a, b, skip) {
  return blank.evaluate(async ([a, b, skip]) => {
    const pixels = async (src) => { const i = new Image(); i.src = src; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return [x.getImageData(0, 0, i.width, i.height).data, i.width, i.height]; };
    const [[p, w, h], [q]] = [await pixels(a), await pixels(b)];
    let n = 0, counted = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (skip.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
      counted++;
      const i = (y * w + x) * 4;
      if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 24) n++;
    }
    return { changed: n, counted };
  }, [read(a), read(b), skip]);
}
// hero windows in image pixels from the top left (the probe's are from the bottom left)
const boxes = (windows, canvasHeight) => windows.map((w) => ({ x: w.x, y: canvasHeight - w.y - w.h, w: w.w, h: w.h }));
const union = (list) => list.length ? (({ x0, y0, x1, y1 }) => ({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }))({
  x0: Math.min(...list.map((b) => b.x)), y0: Math.min(...list.map((b) => b.y)), x1: Math.max(...list.map((b) => b.x + b.w)), y1: Math.max(...list.map((b) => b.y + b.h)) }) : null;
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://localhost:5216/')).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const blank = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  // 1. shores
  for (const [shot, yaw] of [['island', 3.14], ['dialogue', 3.14], ['beacon', 1.57]]) for (const distance of [4, 12]) {
    const name = `${shot}-d${distance}`;
    let skip = [];
    for (const pen of [...PENS, 'bold2']) {
      const file = `shore-${name}-${pen}.png`;
      await load(page, shot, `pen=${pen === 'bold2' ? 'bold' : pen}&cam=${distance},0.3,${yaw}`);
      const probe = await probeOf(page);
      await page.screenshot({ path: join(dir, file) });
      skip = [...skip, ...boxes(probe.windows, probe.canvas[1])];
      if (pen !== 'bold') results.shores.push({ shot, distance, pen, rung: probe.rung, file });
    }
    for (const row of results.shores.filter((r) => r.shot === shot && r.distance === distance)) Object.assign(row, await changed(blank, `shore-${name}-bold.png`, row.file, skip));
    console.log(name, JSON.stringify(results.shores.filter((r) => r.shot === shot && r.distance === distance).map((r) => [r.pen, r.changed, r.rung])));
  }
  // 2. middle band
  for (const pen of PENS) {
    const file = `band-${pen}-d10.png`;
    await load(page, 'upgraded', `pen=${pen}&cam=10,0.07,1.57`);
    const probe = await probeOf(page);
    await page.screenshot({ path: join(dir, file) });
    const box = union(boxes(probe.windows, probe.canvas[1]));
    if (box) await crop(blank, file, box, 'crop-' + file, 1);
    results.band.push({ pen, file, rung: probe.rung, box });
  }
  // 3. all the way in, and its waterline at 300%
  for (const pen of ['bold', 'calm', 'calm-hull']) {
    const file = `near-${pen}-d4.png`;
    await load(page, 'upgraded', `pen=${pen}&cam=4,0.07,1.57`);
    const probe = await probeOf(page);
    await page.screenshot({ path: join(dir, file) });
    const box = union(boxes(probe.windows, probe.canvas[1]));
    if (box) await crop(blank, file, { x: Math.round(box.x + box.w / 2 - 150), y: Math.min(900 - 120, Math.round(box.y + box.h * 0.62)), w: 300, h: 120 }, 'crop-waterline-' + file, 3);
    results.near.push({ pen, file, rung: probe.rung, box, ...(pen === 'bold' ? {} : await changed(blank, 'near-bold-d4.png', file, [])) });
  }
  console.log('band', JSON.stringify(results.band.map((r) => [r.pen, r.rung])), 'near', JSON.stringify(results.near.map((r) => [r.pen, r.changed])));
  await browser.close();
} finally {
  writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 1));
  server.kill();
}
