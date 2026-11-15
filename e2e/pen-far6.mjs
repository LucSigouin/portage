// Round pen-far, run 6: the everyday views. The staged shots island, play and upgraded at their own staged camera,
// each with ?pen=bold (the pen that is live) and with no pen in the address (calm-hull, the game's pen now).
// All shots 1600x900, ladder pinned (&rung=0&hold=1), interface hidden. For each pair: the changed pixels, and one
// picture of the figure or the canoe at 200%, bold on the left and the new pen on the right.
//   node e2e/pen-far6.mjs --out <folder>   (starts its own dev server on 5216, kills it at the end)
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.argv[process.argv.indexOf('--out') + 1];
const folder = join(out, 'shots6');
mkdirSync(folder, { recursive: true });
const game = join(dirname(fileURLToPath(import.meta.url)), '..', 'game');
const server = spawn(join(game, 'node_modules', '.bin', 'vite'), ['--port', '5216', '--strictPort'], { cwd: game, stdio: 'ignore' });
const results = [];
const probeOf = (page) => page.evaluate(() => {
  const look = window.portage.worldView.probe();
  return { rung: look.rung, canvas: [look.canvasWidth, look.canvasHeight], windows: look.hero.windows, subject: look.hero.subject, penShare: look.hero.pen, pen: window.portage.worldView.penName ?? null };
});
const read = (file) => 'data:image/png;base64,' + readFileSync(join(folder, file)).toString('base64');
try {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if ((await fetch('http://localhost:5216/')).ok) break; } catch { /* not yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const blank = await browser.newPage();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  for (const shot of ['island', 'play', 'upgraded']) {
    const looks = {};
    for (const pen of ['bold', 'new']) {
      await page.goto(`http://localhost:5216/?shot=${shot}${pen === 'bold' ? '&pen=bold' : ''}&rung=0&hold=1`, { waitUntil: 'load' });
      await page.waitForFunction(() => window.portage && window.portage.worldView, null, { timeout: 30000 });
      await page.addStyleTag({ content: '#interface { visibility: hidden !important; }' });
      await page.waitForTimeout(2500);
      looks[pen] = await probeOf(page);
      await page.screenshot({ path: join(folder, `${shot}-${pen}.png`) });
    }
    // The crop: the local player's figure where the look names one ashore, the hero windows (canoe and crew) otherwise.
    const look = looks.new;
    const scale = 1600 / look.canvas[0];
    const subject = shot === 'island' ? look.subject : null;
    let box;
    if (subject) box = { x: subject.x - 60, y: subject.y - 40, width: subject.width + 120, height: subject.height + 80 };
    else {
      const left = Math.min(...look.windows.map((w) => w.x)) * scale;
      const right = Math.max(...look.windows.map((w) => w.x + w.w)) * scale;
      const top = Math.min(...look.windows.map((w) => look.canvas[1] - w.y - w.h)) * scale;
      const bottom = Math.max(...look.windows.map((w) => look.canvas[1] - w.y)) * scale;
      box = { x: left - 20, y: top - 20, width: right - left + 40, height: bottom - top + 40 };
    }
    const row = await blank.evaluate(async ([first, second, box]) => {
      const load = async (source) => { const image = new Image(); image.src = source; await image.decode(); return image; };
      const [bold, fresh] = [await load(first), await load(second)];
      const pixels = (image) => { const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; const context = canvas.getContext('2d'); context.drawImage(image, 0, 0); return context.getImageData(0, 0, image.width, image.height).data; };
      const [before, after] = [pixels(bold), pixels(fresh)];
      let changed = 0;
      let exact = 0;
      for (let index = 0; index < before.length; index += 4) {
        const difference = Math.abs(before[index] - after[index]) + Math.abs(before[index + 1] - after[index + 1]) + Math.abs(before[index + 2] - after[index + 2]);
        if (difference > 24) changed += 1;
        if (difference > 0) exact += 1;
      }
      const x = Math.max(0, Math.floor(box.x));
      const y = Math.max(0, Math.floor(box.y));
      const width = Math.min(bold.width - x, Math.ceil(box.width));
      const height = Math.min(bold.height - y, Math.ceil(box.height));
      const pair = document.createElement('canvas');
      pair.width = width * 4 + 8;
      pair.height = height * 2;
      const context = pair.getContext('2d');
      context.imageSmoothingEnabled = false;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, pair.width, pair.height);
      context.drawImage(bold, x, y, width, height, 0, 0, width * 2, height * 2);
      context.drawImage(fresh, x, y, width, height, width * 2 + 8, 0, width * 2, height * 2);
      return { changed, exact, total: before.length / 4, crop: [x, y, width, height], data: pair.toDataURL('image/png') };
    }, [read(`${shot}-bold.png`), read(`${shot}-new.png`), box]);
    writeFileSync(join(folder, `${shot}-pair-200.png`), Buffer.from(row.data.split(',')[1], 'base64'));
    delete row.data;
    results.push({ shot, penShare: { bold: looks.bold.penShare, new: looks.new.penShare }, pen: [looks.bold.pen, looks.new.pen], rung: [looks.bold.rung, looks.new.rung], ...row });
    console.log(JSON.stringify(results[results.length - 1]));
  }
  await browser.close();
} finally {
  writeFileSync(join(folder, 'results.json'), JSON.stringify(results, null, 1));
  server.kill();
}
