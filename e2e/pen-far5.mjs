// Round pen-far, run 5: the game's pen is calm-hull. Each view with NO ?pen= (the default) beside the same view
// with ?pen=bold (C, the pen before). All shots 1600x900, ladder pinned (&rung=0&hold=1), held still.
//   1. the canoe (?shot=upgraded) at 4, 10 and 28 m, level, side on: changed pixels, whole picture.
//   2. one shore (?shot=island, 4 m): changed pixels outside every hero window, and bold against bold (noise).
//   3. the pick screen (?shot=cast): each card's own canvas read back, default against bold, pixel by pixel.
//   4. one shot with &fps=1: the read-out's text, and a picture of it.
//   node e2e/pen-far5.mjs --out <folder>   (starts its own dev server on 5216, kills it at the end)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[process.argv.indexOf('--out') + 1];
const dir = join(out, 'shots5');
mkdirSync(dir, { recursive: true });
const game = join(dirname(fileURLToPath(import.meta.url)), '..', 'game');
const server = spawn(join(game, 'node_modules', '.bin', 'vite'), ['--port', '5216', '--strictPort'], { cwd: game, stdio: 'ignore' });
const results = { canoe: [], shore: [], cards: [], readout: null };
const probeOf = (page) => page.evaluate(() => {
  const p = window.portage.worldView.probe();
  return { rung: p.rung, canvas: [p.canvasWidth, p.canvasHeight], windows: p.hero.windows, pen: window.portage.worldView.penName ?? null };
});
async function load(page, shot, query, wait = 2500) {
  await page.goto(`http://localhost:5216/?shot=${shot}${query ? '&' + query : ''}&rung=0&hold=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.portage && window.portage.worldView, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(wait);
}
const read = (f) => 'data:image/png;base64,' + readFileSync(join(dir, f)).toString('base64');
const save = (file, data) => writeFileSync(join(dir, file), Buffer.from(data.split(',')[1], 'base64'));
// Changed pixels between two pictures (data addresses), leaving out the given boxes (image pixels from the top left).
async function changed(blank, a, b, skip = []) {
  return blank.evaluate(async ([a, b, skip]) => {
    const pixels = async (src) => { const i = new Image(); i.src = src; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return [x.getImageData(0, 0, i.width, i.height).data, i.width, i.height]; };
    const [[p, w, h], [q, w2, h2]] = [await pixels(a), await pixels(b)];
    if (w !== w2 || h !== h2) return { changed: -1, counted: 0, exact: -1, size: [w, h, w2, h2] };
    let n = 0, exact = 0, counted = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (skip.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)) continue;
      counted++;
      const i = (y * w + x) * 4;
      const d = Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]) + Math.abs(p[i + 3] - q[i + 3]);
      if (d > 24) n++;
      if (d > 0) exact++;
    }
    return { changed: n, exact, counted };
  }, [a, b, skip]);
}
const boxes = (windows, canvasHeight) => windows.map((w) => ({ x: w.x, y: canvasHeight - w.y - w.h, w: w.w, h: w.h }));
// Every 2D canvas on the page that holds ink (the cards' pictures), as PNG data addresses with their size.
const cardsOf = (page) => page.evaluate(() => [...document.querySelectorAll('canvas')].map((canvas) => {
  if (canvas.classList.contains('iw-chart-canvas')) return null;
  let context = null;
  try { context = canvas.getContext('2d'); } catch { /* a WebGL canvas */ }
  if (!context || canvas.width === 0) return null;
  return { width: canvas.width, height: canvas.height, data: canvas.toDataURL('image/png') };
}).filter(Boolean));
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://localhost:5216/')).ok) break; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const blank = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  // 3 first (the one finding nobody has measured yet): the pick screen's cards
  const cards = {};
  for (const pen of ['default', 'bold', 'bold2', 'today']) {
    await load(page, 'cast', pen === 'default' ? '' : `pen=${pen === 'bold2' ? 'bold' : pen}`, 5000);
    await page.screenshot({ path: join(dir, `cast-${pen}.png`) });
    cards[pen] = await cardsOf(page);
    cards[pen].forEach((card, index) => { if (pen !== 'bold2') save(`card-${index}-${pen}.png`, card.data); });
  }
  for (const pen of ['default', 'bold2', 'today']) for (let index = 0; index < cards.bold.length; index++) {
    const other = cards[pen][index];
    const row = { card: index, pen, against: 'bold', size: [cards.bold[index].width, cards.bold[index].height], ...(other ? await changed(blank, cards.bold[index].data, other.data) : { changed: -1, missing: true }) };
    results.cards.push(row);
  }
  console.log('cards', cards.default.length, JSON.stringify(results.cards.map((r) => [r.card, r.pen, r.changed, r.exact])));
  // 1. the canoe, level and side on
  for (const distance of [4, 10, 28]) {
    const rows = {};
    for (const pen of ['default', 'bold']) {
      const file = `canoe-d${distance}-${pen}.png`;
      await load(page, 'upgraded', `${pen === 'default' ? '' : 'pen=bold&'}cam=${distance},0.07,1.57`);
      rows[pen] = await probeOf(page);
      await page.screenshot({ path: join(dir, file) });
    }
    const row = { distance, rung: [rows.default.rung, rows.bold.rung], ...(await changed(blank, read(`canoe-d${distance}-bold.png`), read(`canoe-d${distance}-default.png`))) };
    const skip = [...boxes(rows.default.windows, rows.default.canvas[1]), ...boxes(rows.bold.windows, rows.bold.canvas[1])];
    row.outsideHeroes = (await changed(blank, read(`canoe-d${distance}-bold.png`), read(`canoe-d${distance}-default.png`), skip)).changed;
    results.canoe.push(row);
    console.log('canoe', JSON.stringify(row));
  }
  // 2. one shore
  {
    let skip = [];
    const rungs = {};
    for (const pen of ['bold', 'default', 'bold2']) {
      await load(page, 'island', `${pen === 'default' ? '' : 'pen=bold&'}cam=4,0.3,3.14`);
      const probe = await probeOf(page);
      rungs[pen] = probe.rung;
      await page.screenshot({ path: join(dir, `shore-island-d4-${pen}.png`) });
      skip = [...skip, ...boxes(probe.windows, probe.canvas[1])];
    }
    for (const pen of ['default', 'bold2']) results.shore.push({ pen, against: 'bold', rung: rungs[pen], whole: (await changed(blank, read('shore-island-d4-bold.png'), read(`shore-island-d4-${pen}.png`))).changed, ...(await changed(blank, read('shore-island-d4-bold.png'), read(`shore-island-d4-${pen}.png`), skip)) });
    console.log('shore', JSON.stringify(results.shore));
  }
  // 4. the read-out
  {
    await load(page, 'upgraded', 'cam=10,0.07,1.57&fps=1', 4000);
    await page.screenshot({ path: join(dir, 'readout-fps.png') });
    results.readout = await page.evaluate(() => {
      const hit = [...document.querySelectorAll('body *')].filter((element) => element.children.length === 0 && /rung \d+/.test(element.textContent ?? ''));
      return hit.map((element) => { const r = element.getBoundingClientRect(); return { text: element.textContent, box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], parent: element.parentElement?.textContent ?? null }; });
    });
    console.log('readout', JSON.stringify(results.readout));
  }
  await browser.close();
} finally {
  writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 1));
  server.kill();
}
