// Round pen-far, run 3: Luc's kind of screen (1920x1080 CSS at 2 device pixels a CSS pixel), with the render scale and
// ladder rung each shot got; 300% crops of the canoe's bottom and its hero window's edge; a canoe-only pixel count all
// the way in with the ladder pinned (&rung=0&hold=1); and six even steps from 5 m to 16 m under calm.
//   node e2e/pen-far3.mjs --out <folder>   (starts its own dev server on 5216, kills it at the end)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[process.argv.indexOf('--out') + 1];
const dir = join(out, 'shots3');
mkdirSync(dir, { recursive: true });
const game = join(dirname(fileURLToPath(import.meta.url)), '..', 'game');
const server = spawn(join(game, 'node_modules', '.bin', 'vite'), ['--port', '5216', '--strictPort'], { cwd: game, stdio: 'ignore' });
const results = { big: [], near: [], steps: [] };
const stepsOnly = process.argv.includes('--steps');
const probeOf = (page) => page.evaluate(() => {
  const p = window.portage.worldView.probe();
  return { rung: p.rung, drawing: [p.drawingWidth, p.drawingHeight], canvas: [p.canvasWidth, p.canvasHeight], windows: p.hero.windows, inkScale: p.hero.inkScale, pen: p.hero.pen };
});
async function load(page, query, wait) {
  await page.goto(`http://localhost:5216/?shot=upgraded&${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.portage && window.portage.worldView, null, { timeout: 30000 });
  await page.waitForTimeout(wait);
}
// 300% crop, nearest neighbour, drawn in a blank page: rect in image pixels from the top left.
async function crop(blank, file, rect, outFile) {
  const data = 'data:image/png;base64,' + readFileSync(join(dir, file)).toString('base64');
  const png = await blank.evaluate(async ([data, r]) => {
    const image = new Image(); image.src = data; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = r.w * 3; canvas.height = r.h * 3;
    const context = canvas.getContext('2d'); context.imageSmoothingEnabled = false;
    context.drawImage(image, r.x, r.y, r.w, r.h, 0, 0, r.w * 3, r.h * 3);
    context.strokeStyle = '#e0157a'; context.lineWidth = 3; context.strokeRect(1.5, 1.5, r.w * 3 - 3, r.h * 3 - 3);
    return canvas.toDataURL('image/png');
  }, [data, rect]);
  writeFileSync(join(dir, outFile), Buffer.from(png.split(',')[1], 'base64'));
}
// Changed pixels between two shots inside one box (image pixels from the top left).
async function changed(blank, a, b, r) {
  const read = (f) => 'data:image/png;base64,' + readFileSync(join(dir, f)).toString('base64');
  return blank.evaluate(async ([a, b, r]) => {
    const pixels = async (src) => { const i = new Image(); i.src = src; await i.decode(); const c = document.createElement('canvas'); c.width = r.w; c.height = r.h; const x = c.getContext('2d'); x.drawImage(i, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); return x.getImageData(0, 0, r.w, r.h).data; };
    const [p, q] = [await pixels(a), await pixels(b)];
    let n = 0; for (let i = 0; i < p.length; i += 4) if (Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) > 24) n++;
    return { changed: n, box: r.w * r.h };
  }, [read(a), read(b), r]);
}
const boxOf = (windows, canvasHeight) => {
  if (!windows.length) return null;
  const x0 = Math.min(...windows.map((w) => w.x)), y0 = Math.min(...windows.map((w) => w.y));
  const x1 = Math.max(...windows.map((w) => w.x + w.w)), y1 = Math.max(...windows.map((w) => w.y + w.h));
  return { x: x0, y: canvasHeight - y1, w: x1 - x0, h: y1 - y0 };
};
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://localhost:5216/')).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const blank = await browser.newPage();
  // 1. Luc's kind of screen. The ladder runs as it would for him (chip test, then 5 s of frames), so each shot reports its rung.
  let page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
  const big = [];
  for (const distance of [7, 10]) for (const pitch of [0.07, 0.34]) for (const yaw of [0, 1.57, 3.14, 4.71]) big.push(['bold', distance, pitch, yaw, '']);
  for (const yaw of [0, 1.57, 3.14, 4.71]) big.push(['calm', 10, 0.07, yaw, '']);
  for (const pen of ['bold', 'calm', 'calm-keel']) for (const distance of [7, 10]) big.push([pen, distance, 0.07, 1.57, '&rung=0&hold=1']);
  for (const pen of ['bold', 'calm']) big.push([pen, 10, 0.07, 1.57, '&rung=11&hold=1']);
  for (const [pen, distance, pitch, yaw, pin] of stepsOnly ? [] : big) {
    const file = `big-${pen}-d${distance}-p${pitch}-y${yaw}${pin ? '-rung' + pin.match(/rung=(\d+)/)[1] : ''}.png`;
    await load(page, `pen=${pen}&cam=${distance},${pitch},${yaw}${pin}`, pin ? 2500 : 5000);
    const probe = await probeOf(page);
    await page.screenshot({ path: join(dir, file) });
    const box = boxOf(probe.windows, probe.canvas[1]);
    if (box) {
      // the canoe's bottom middle (waterline) and its hero window's left edge, 300%
      await crop(blank, file, { x: Math.max(0, Math.round(box.x + box.w / 2 - 200)), y: Math.max(0, Math.round(box.y + box.h - 170)), w: 400, h: 200 }, 'crop-bottom-' + file);
      await crop(blank, file, { x: Math.max(0, Math.round(box.x - 100)), y: Math.max(0, Math.round(box.y + box.h / 2 - 100)), w: 200, h: 200 }, 'crop-edge-' + file);
    }
    results.big.push({ file, pen, distance, pitch, yaw, pin, ...probe, windows: probe.windows.length, box });
    console.log('saved', file, 'rung', probe.rung, 'world', probe.drawing.join('x'), 'canvas', probe.canvas.join('x'));
  }
  await page.close();
  // 3. Near must not change: 1600x900, ladder pinned at rung 0, canoe box only.
  page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const pitch of stepsOnly ? [] : [0.34, 0.07]) {
    let box = null;
    for (const pen of ['bold', 'bold2', 'soon', 'calm', 'fine', 'calm-keel']) {
      const file = `near-${pen}-p${pitch}.png`;
      await load(page, `pen=${pen === 'bold2' ? 'bold' : pen}&cam=4,${pitch},1.57&rung=0&hold=1`, 2500);
      const probe = await probeOf(page);
      box ??= boxOf(probe.windows, probe.canvas[1]);
      await page.screenshot({ path: join(dir, file) });
      if (pen !== 'bold') results.near.push({ pen, pitch, rung: probe.rung, ...(await changed(blank, `near-bold-p${pitch}.png`, file, box)) });
    }
    console.log('near', pitch, JSON.stringify(results.near.filter((r) => r.pitch === pitch)));
  }
  // 4. Steps: calm, level, side on, 5 to 16 m in six even steps, ladder pinned; crop of the canoe's box.
  for (const distance of [5, 7.2, 9.4, 11.6, 13.8, 16]) {
    const file = `step-calm-d${distance}.png`;
    await load(page, `pen=calm&cam=${distance},0.07,1.57&rung=0&hold=1`, 2500);
    const probe = await probeOf(page);
    const box = boxOf(probe.windows, probe.canvas[1]);
    await page.screenshot({ path: join(dir, file) });
    if (box) await page.screenshot({ path: join(dir, 'crop-' + file), clip: { x: box.x, y: box.y, width: box.w, height: box.h } });
    results.steps.push({ file, distance, pen: probe.pen, box });
  }
  await browser.close();
} finally {
  writeFileSync(join(dir, stepsOnly ? 'results-steps.json' : 'results.json'), JSON.stringify(results, null, 1));
  server.kill();
}
