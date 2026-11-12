// Portage workbench: the debrief page. Every step so far, in point form, made for a phone first.
//
// HOW TO
//   Build:   node hub/workbench.mjs --out <folder>     writes <folder>/workbench.html and <folder>/workbench/
//   The hub build (hub/build.mjs) calls buildWorkbench(hub/site), so the page ships with the hub as workbench.html.
//
// KEEPING IT CURRENT
//   Edit hub/workbench.json only: the words and the numbers. Its "_how" lines explain the shape. Then rebuild.
//   The page is src/workbench.html with src/workbench.css inlined. No word on the page is written here,
//   except the labels in LABELS below.
//
// WHAT IT WRITES (all inside the folder it is given)
//   workbench.html          the page: static HTML and CSS, reads with scripts off, asks nothing of another site
//   workbench/fonts/        the game's two faces, copied from game/src/interface/fonts/
//   workbench/pics/         each picture as JPEG, about 800 px wide for a phone and about 1600 px, made with sips
//
// PICTURES
//   A "src" that starts with shots/ is already in the site and is used as it is.
//   Any other "src" is a path from the portage folder. In a git worktree the main checkout is tried as well.
//   A picture that is missing is left off the page with a warning. It never stops the build.
//
// No dependencies. Nothing here moves by itself: the pen lines are drawn once, as pictures.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from './src/markdown.mjs';

const HUB = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HUB, '..');
const FONTS = join(ROOT, 'game/src/interface/fonts');

const STATES = ['done', 'running', 'next'];
/** The only words on the page that are not in workbench.json. */
const LABELS = {
  ask: 'The ask',
  now: 'Now',
  run: 'The run',
  steps: 'The steps',
  asked: 'You asked',
  built: { done: 'Built', running: 'Building', next: 'To build' },
  proof: 'Proof',
  snags: 'Snags',
  report: 'Read the report',
  calls: 'Your calls',
  wrong: 'What went wrong',
  numbers: 'The numbers',
  left: 'What is left',
  hours: 'hours',
  yours: 'Yours to judge',
  links: 'Links',
};
const PHONE_WIDTH = 800;
const FULL_WIDTH = 1600;

const read = (path) => readFileSync(path, 'utf8');
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in values)) throw new Error(`workbench: the template asks for {{${key}}} and the build has no value for it.`);
  return values[key];
});

// ---------------------------------------------------------------- the words

function checkWords(words) {
  const fault = (text) => { throw new Error(`workbench.json: ${text}`); };
  const text = (value, where) => { if (typeof value !== 'string' || value === '') fault(`${where} must be a line of text.`); };
  const list = (value, where) => { if (!Array.isArray(value)) fault(`${where} must be a list.`); return value; };
  for (const key of ['title', 'subtitle', 'updated', 'ask']) text(words[key], `"${key}"`);
  list(words.now, '"now"').forEach((row, at) => { text(row.label, `now[${at}].label`); text(row.value, `now[${at}].value`); });
  list(words.steps, '"steps"').forEach((step, at) => {
    const where = `steps[${at}]`;
    text(step.title, `${where}.title`);
    text(step.when, `${where}.when`);
    if (!STATES.includes(step.state)) fault(`${where}.state is "${step.state}". It must be one of: ${STATES.join(', ')}.`);
    for (const key of ['built', 'proof', 'snags']) list(step[key], `${where}.${key}`).forEach((line) => text(line, `a line of ${where}.${key}`));
    list(step.pictures, `${where}.pictures`).forEach((picture) => { text(picture.src, `${where} picture src`); text(picture.alt, `${where} picture alt`); });
    for (const key of ['asked', 'report']) if (typeof step[key] !== 'string') fault(`${where}.${key} must be text. Leave it "" when there is none.`);
  });
  for (const key of ['calls', 'snags', 'yours']) list(words[key], `"${key}"`).forEach((line) => text(line, `a line of "${key}"`));
  list(words.numbers, '"numbers"').forEach((row, at) => { text(row.label, `numbers[${at}].label`); text(row.value, `numbers[${at}].value`); });
  list(words.left, '"left"').forEach((row, at) => { text(row.what, `left[${at}].what`); text(row.hours, `left[${at}].hours`); });
  list(words.links, '"links"').forEach((row, at) => { text(row.title, `links[${at}].title`); text(row.href, `links[${at}].href`); });
}

// ---------------------------------------------------------------- pen and paper, drawn once

/** A small repeatable random number maker, so every build draws the same lines. */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** An SVG as a CSS url(). Single quotes inside, so it can sit in a double-quoted string. */
const cssPicture = (svg) => `url("data:image/svg+xml,${svg.replace(/[#%<>]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)}")`;

const TILE = 240;
const CORNER = 30;
const INSET = 6;

/**
 * A sheet of paper with a pen border that wavers, as a border-image tile. The middle of each side starts
 * and ends level, so the tile repeats along a long edge without a seam. A shadow sits low and to the right.
 * Drawn here, once, rather than with a live filter: a phone has nothing to work out while it scrolls.
 */
function penTile({ seed, paper, dash = '', ink = '#2a2b33' }) {
  const random = seeded(seed);
  const waver = () => {
    const waves = [1, 2, 3].map((count) => ({ count, size: (1.5 / count) * (0.6 + random() * 0.8), shift: random() * Math.PI * 2 }));
    return (along) => Math.sin(Math.PI * along) ** 2 * waves.reduce((sum, wave) => sum + wave.size * Math.sin(Math.PI * 2 * wave.count * along + wave.shift), 0);
  };
  const far = TILE - INSET;
  const point = (x, y) => `${x.toFixed(1).replace(/\.0$/, '')} ${y.toFixed(1).replace(/\.0$/, '')}`;
  const side = (toPoint) => {
    const wave = waver();
    const points = [];
    for (let step = 1; step <= 20; step++) points.push(`L${toPoint(step / 20, wave(step / 20))}`);
    return points.join('');
  };
  const span = TILE - CORNER * 2;
  const round = () => 5 + random() * 6;
  const corners = [round(), round(), round(), round()];
  const path = `M${point(CORNER, INSET)}`
    + side((along, off) => point(CORNER + span * along, INSET + off))
    + `L${point(far - corners[0], INSET)}Q${point(far, INSET)} ${point(far, INSET + corners[0])}L${point(far, CORNER)}`
    + side((along, off) => point(far + off, CORNER + span * along))
    + `L${point(far, far - corners[1])}Q${point(far, far)} ${point(far - corners[1], far)}L${point(TILE - CORNER, far)}`
    + side((along, off) => point(TILE - CORNER - span * along, far + off))
    + `L${point(INSET + corners[2], far)}Q${point(INSET, far)} ${point(INSET, far - corners[2])}L${point(INSET, TILE - CORNER)}`
    + side((along, off) => point(INSET + off, TILE - CORNER - span * along))
    + `L${point(INSET, INSET + corners[3])}Q${point(INSET, INSET)} ${point(INSET + corners[3], INSET)}Z`;
  return cssPicture(`<svg xmlns='http://www.w3.org/2000/svg' width='${TILE}' height='${TILE}' viewBox='0 0 ${TILE} ${TILE}'>`
    + `<path d='${path}' transform='translate(1.6 3)' fill='#2a2b33' fill-opacity='.2'/>`
    + `<path d='${path}' fill='${paper}' stroke='${ink}' stroke-width='1.7' stroke-linejoin='round' stroke-linecap='round'${dash ? ` stroke-dasharray='${dash}'` : ''}/></svg>`);
}

/** Paper tooth: a fixed tile of faint ink specks. */
const PAPER_TOOTH = cssPicture("<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'>"
  + "<filter id='tooth' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' seed='4' stitchTiles='stitch'/>"
  + "<feColorMatrix values='0 0 0 0 .16  0 0 0 0 .17  0 0 0 0 .2  0 0 0 .62 -.27'/></filter><rect width='256' height='256' filter='url(#tooth)'/></svg>");

function drawnCss() {
  const bright = '#fbf5e6';
  return ':root {\n'
    + `  --pen-a: ${penTile({ seed: 7, paper: bright })};\n`
    + `  --pen-b: ${penTile({ seed: 23, paper: bright })};\n`
    + `  --pen-c: ${penTile({ seed: 41, paper: bright })};\n`
    + `  --pen-running: ${penTile({ seed: 59, paper: bright, dash: '9 6' })};\n`
    + `  --pen-next: ${penTile({ seed: 71, paper: '#e8dec8', dash: '3 6', ink: '#5b5f6b' })};\n`
    + `  --tooth: ${PAPER_TOOTH};\n`
    + '}';
}

// ---------------------------------------------------------------- pictures

function pixelSize(file) {
  const told = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const width = Number(/pixelWidth: (\d+)/.exec(told)?.[1]);
  const height = Number(/pixelHeight: (\d+)/.exec(told)?.[1]);
  if (!width || !height) throw new Error('sips could not read its size');
  return { width, height };
}

let mainCheckout;
/** The portage folders a picture path may start from: this one, and in a git worktree the main checkout too. */
function pictureRoots() {
  if (mainCheckout === undefined) {
    mainCheckout = null;
    try {
      const shared = execFileSync('git', ['-C', ROOT, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (shared.endsWith('/.git') && dirname(shared) !== ROOT) mainCheckout = dirname(shared);
    } catch { /* not a git checkout: only this folder is tried */ }
  }
  return mainCheckout ? [ROOT, mainCheckout] : [ROOT];
}

/** One picture, ready for the page, or null (with a warning) when it cannot be had. */
function preparePicture(picture, out, warn) {
  try {
    if (picture.src.startsWith('shots/')) {
      const file = join(out, picture.src);
      if (!existsSync(file)) { warn(`picture left off: ${picture.src} is not in ${out}`); return null; }
      return { alt: picture.alt, phone: picture.src, full: picture.src, phoneWidth: 0, ...pixelSize(file) };
    }
    const source = pictureRoots().map((root) => resolve(root, picture.src)).find((file) => existsSync(file));
    if (!source) { warn(`picture left off: ${picture.src} was not found from ${pictureRoots().join(' or ')}`); return null; }
    const size = pixelSize(source);
    const name = slug(picture.src.replace(/^(\.\.\/)+/, '').replace(/\.\w+$/, ''));
    const make = (wide, quality) => {
      const width = Math.min(wide, size.width);
      const path = `workbench/pics/${name}-${width}.jpg`;
      const target = join(out, path);
      // An unchanged picture is not made twice.
      if (!existsSync(target) || statSync(target).mtimeMs < statSync(source).mtimeMs) {
        execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), '--resampleWidth', String(width), source, '--out', target], { stdio: ['ignore', 'ignore', 'pipe'] });
      }
      return { path, width };
    };
    const phone = make(PHONE_WIDTH, 68);
    const full = make(FULL_WIDTH, 74);
    return { alt: picture.alt, phone: phone.path, full: full.path, phoneWidth: phone.width, width: full.width, height: Math.round(size.height * full.width / size.width) };
  } catch (error) {
    warn(`picture left off: ${picture.src} could not be made (${String(error.message).split('\n')[0]})`);
    return null;
  }
}

function pictureHtml(picture) {
  const two = picture.phone !== picture.full;
  // A phone is handed the small one outright. Wider screens choose by their own sharpness.
  const source = two ? `<source media="(max-width: 720px)" srcset="${escapeHtml(picture.phone)}">` : '';
  const choose = two ? ` srcset="${escapeHtml(picture.phone)} ${picture.phoneWidth}w, ${escapeHtml(picture.full)} ${picture.width}w" sizes="(min-width: 1100px) 26rem, 92vw"` : '';
  return `<figure class="pic"><a class="frame" href="${escapeHtml(picture.full)}"><picture>${source}`
    + `<img src="${escapeHtml(picture.full)}"${choose} width="${picture.width}" height="${picture.height}" loading="lazy" decoding="async" alt="${escapeHtml(picture.alt)}">`
    + `</picture></a><figcaption aria-hidden="true">${escapeHtml(picture.alt)}</figcaption></figure>`;
}

// ---------------------------------------------------------------- the page

const TICK = '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.8c2 1.5 3.6 3.3 4.9 5.4C12 12 15.5 7.5 20.5 3.8"/></svg>';
const stateMark = (state) => (state === 'done' ? TICK : `<i class="dab" aria-hidden="true"></i>`);

const lines = (items, kind) => `<ul class="${kind}">${items.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>`;

function nowHtml(rows) {
  return rows.map((row) => `      <div><dt>${escapeHtml(row.label)}</dt><dd>${
    row.href ? `<a class="go" href="${escapeHtml(row.href)}">${escapeHtml(row.value)}</a>` : escapeHtml(row.value)}</dd></div>`).join('\n');
}

/** The whole run on one screen: every step by number and name, grouped by day, each a jump to its card. */
function runHtml(steps) {
  const days = [];
  steps.forEach((step, at) => {
    if (days.at(-1)?.when !== step.when) days.push({ when: step.when, first: at + 1, rows: [] });
    days.at(-1).rows.push(`<li><a class="is-${step.state}" href="#step-${at + 1}"><span class="pip">${at + 1}</span>`
      + `<span class="name">${escapeHtml(step.title)}</span><span class="state">${stateMark(step.state)}<span>${step.state}</span></span></a></li>`);
  });
  return days.map((day) => `      <h3 class="day">${escapeHtml(day.when)}</h3>\n      <ol start="${day.first}">${day.rows.join('')}</ol>`).join('\n');
}

const tallyHtml = (steps) => STATES
  .map((state) => ({ state, count: steps.filter((step) => step.state === state).length }))
  .filter(({ count }) => count > 0)
  .map(({ state, count }) => `<span class="state is-${state}">${stateMark(state)}<span>${count} ${state}</span></span>`).join('');

function stepHtml(step, at, pictures) {
  const part = (label, body) => `<div class="part"><h4 class="over">${label}</h4>${body}</div>`;
  const parts = [
    step.asked ? part(LABELS.asked, `<blockquote>${escapeHtml(step.asked)}</blockquote>`) : '',
    step.built.length ? part(LABELS.built[step.state], lines(step.built, 'dabs')) : '',
    step.proof.length ? part(LABELS.proof, lines(step.proof, 'dabs good')) : '',
    step.snags.length ? part(LABELS.snags, lines(step.snags, 'dabs bad')) : '',
  ].join('');
  return `    <li class="step paper is-${step.state}${pictures.length ? ' has-pics' : ''}" id="step-${at + 1}">`
    + `<div class="top"><span class="pip">${at + 1}</span><span class="when">${escapeHtml(step.when)}</span>`
    + `<span class="state is-${step.state}">${stateMark(step.state)}<span>${step.state}</span></span></div>`
    + `<h3>${escapeHtml(step.title)}</h3>`
    + `<div class="body"><div class="parts">${parts}</div>`
    + (pictures.length ? `<div class="pics">${pictures.map(pictureHtml).join('')}</div>` : '')
    + '</div>'
    + (step.report ? `<a class="btn" href="${escapeHtml(step.report)}" aria-label="${LABELS.report}: ${escapeHtml(step.title)}">${LABELS.report}</a>` : '')
    + '</li>';
}

const ledgerHtml = (rows, name, value) => rows.map((row) => `<div><dt>${escapeHtml(row[name])}</dt><dd>${escapeHtml(row[value])}</dd></div>`).join('');

/**
 * Build the page into `out`. Returns what it did, warnings included.
 * `words` is for the tests: the page is made from that instead of hub/workbench.json.
 */
export function buildWorkbench(out, { words = JSON.parse(read(join(HUB, 'workbench.json'))), say = (text) => console.log(`[workbench] ${text}`) } = {}) {
  const folder = resolve(out);
  const warnings = [];
  const warn = (text) => { warnings.push(text); say(`WARNING: ${text}`); };
  checkWords(words);

  mkdirSync(join(folder, 'workbench/fonts'), { recursive: true });
  mkdirSync(join(folder, 'workbench/pics'), { recursive: true });
  const fonts = readdirSync(FONTS).filter((name) => name.endsWith('.woff2'));
  for (const name of fonts) copyFileSync(join(FONTS, name), join(folder, 'workbench/fonts', name));

  let shown = 0;
  let asked = 0;
  const steps = words.steps.map((step, at) => {
    const pictures = step.pictures.map((picture) => preparePicture(picture, folder, warn)).filter(Boolean);
    shown += pictures.length;
    asked += step.pictures.length;
    return stepHtml(step, at, pictures);
  });

  // A report or link that goes nowhere in this folder is worth a line, never a failure: the hub builds those pages.
  const local = [...words.steps.map((step) => step.report), ...words.links.map((link) => link.href)]
    .filter((href) => href && !/^[a-z]+:/i.test(href) && !existsSync(join(folder, href.replace(/[?#].*$/, ''))));
  if (local.length) warn(`${local.length} links point at pages that are not in ${folder} (${local.slice(0, 3).join(', ')}${local.length > 3 ? ', ...' : ''}). The hub build makes them.`);

  const html = fill(read(join(HUB, 'src/workbench.html')), {
    css: `${drawnCss()}\n${read(join(HUB, 'src/workbench.css')).trim()}`,
    title: escapeHtml(words.title),
    subtitle: escapeHtml(words.subtitle),
    updated: escapeHtml(words.updated),
    ask: escapeHtml(words.ask),
    now: nowHtml(words.now),
    tally: tallyHtml(words.steps),
    run: runHtml(words.steps),
    steps: steps.join('\n'),
    calls: lines(words.calls, 'ticks'),
    wrong: lines(words.snags, 'dabs bad'),
    numbers: ledgerHtml(words.numbers, 'label', 'value'),
    left: ledgerHtml(words.left, 'what', 'hours'),
    yours: lines(words.yours, 'boxes'),
    links: words.links.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a></li>`).join(''),
    ...Object.fromEntries(Object.entries(LABELS).filter(([, label]) => typeof label === 'string').map(([key, label]) => [`label_${key}`, label])),
  });
  writeFileSync(join(folder, 'workbench.html'), html);
  say(`workbench.html ${words.steps.length} steps, ${shown} of ${asked} pictures, ${fonts.length} fonts, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB of HTML: ${folder}`);
  return { file: join(folder, 'workbench.html'), warnings, pictures: shown };
}

// ---------------------------------------------------------------- run

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--out');
  if (flag < 0 || !process.argv[flag + 1]) {
    console.error('Say where to build: node hub/workbench.mjs --out <folder>');
    process.exit(1);
  }
  buildWorkbench(process.argv[flag + 1]);
}
