// Portage hub: one static site with everything in the project, for opening from another computer.
//
// HOW TO
//   Rebuild:  node /Users/ls/Claude-Workspace/personal/portage/hub/build.mjs
//   Check:    node /Users/ls/Claude-Workspace/personal/portage/hub/check.mjs     (exit 1 = something is broken)
//   Serve:    python3 /Users/ls/Claude-Workspace/personal/portage/hub/serve.py   (not `python3 -m http.server`: it drops requests under load)
//             (start it from a CNVS shell node, page 3, never as a background process)
//   Open:     http://100.110.210.9:5230/ (Tailscale, never changes) or the Mac's current network address on port 5230
//             (that one changes when the Mac moves: update "addresses" in hub.json)
//
// KEEPING IT CURRENT
//   Edit hub/hub.json only: the status lists and the links. Its "_how" lines explain the shape. Then rebuild and check.
//   The server keeps running through a rebuild. Reload the page.
//
// WHAT THE BUILD DOES (everything it writes lands in hub/site/, nothing else is touched)
//   looks/a|b|b2|c/ each art look, built with its own vite, relative base so it works under a sub-path
//   compare-b.html look B against B2: src/compare-b.html filled with the screenshots and numbers in scratch/portage/b2/
//   game/          the game, with index.html and audio-lab.html as entry pages
//   review.html    copy of art-r1/review.html, its three localhost addresses turned into links to looks/
//   shots/         thumbnails, downscaled to JPEG with sips
//   docs/          every hub.json link that has "from": that markdown file rendered to HTML
//   index.html     the hub page: hub.json poured into src/hub.html with src/style.css inlined
//   workbench.html the debrief page for a phone: workbench.json poured into src/workbench.html (see workbench.mjs)
//
// No dependencies of its own. It borrows vite from each project's node_modules.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { escapeHtml, firstHeading, renderMarkdown } from './src/markdown.mjs';
import { buildWorkbench } from './workbench.mjs';

const HUB = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HUB, '..');
const SITE = join(HUB, 'site');
const SCRATCH = resolve(ROOT, '../scratch/portage');

/** The vite projects to build. `pages` are the entry pages, relative to the project folder. */
const APPS = [
  { from: 'art-r1/a', to: 'looks/a', pages: ['index.html'] },
  { from: 'art-r1/b', to: 'looks/b', pages: ['index.html'] },
  { from: 'art-r1/b2', to: 'looks/b2', pages: ['index.html'] },
  { from: 'art-r1/c', to: 'looks/c', pages: ['index.html'] },
  { from: 'game', to: 'game', pages: ['index.html', 'audio-lab.html'] },
];

/** Where thumbnails come from. Every matching PNG becomes shots/<name>. */
const PICTURES = [
  { folder: join(SCRATCH, 'client/shots'), match: /^([a-z]+)\.png$/, name: (found) => `game-${found[1]}.jpg` },
  {
    folder: join(ROOT, 'art-r1/review/shots'),
    match: /^([abc])-(lobby|play|upgraded|island|settings|pause)-1080\.png$/,
    name: (found) => `look-${found[1]}-${found[2]}.jpg`,
  },
  { folder: join(SCRATCH, 'b2'), match: /^b2-(lobby|play|upgraded|island|settings|pause)-1080\.png$/, name: (found) => `look-b2-${found[1]}.jpg` },
];
const THUMBNAIL_LONG_SIDE = 480;

/** Dev server ports named in the reports, and the hub copy each one maps to. */
const DEV_PORTS = { 5220: 'game/', 5211: 'looks/a/', 5212: 'looks/b/', 5213: 'looks/c/', 5214: 'looks/b2/' };

/**
 * The "look B against B2" page. Its pictures are cut from the screenshots in scratch/portage/b2/
 * (<look>-<shot>-1080.png, and -1440.png for the 2560x1440 pair); its numbers come from metrics.json there
 * (written by scratch/portage/b2/measure.mjs). Crop x and y are the top-left corner in the screenshot, in pixels.
 */
const COMPARE = {
  folder: join(SCRATCH, 'b2'),
  crop: { width: 620, height: 400 },
  shots: [
    { shot: 'play', title: 'Play', see: 'Starter canoe, paddling toward the island.', crops: [
      { name: 'far', label: 'Island, steeple and far shore', x: 640, y: 170 },
      { name: 'canoe', label: 'Canoe and wake', x: 650, y: 560 },
    ] },
    { shot: 'upgraded', title: 'Upgraded canoe', see: 'Everything bolted on. This is the shot that should reward a close look.', crops: [
      { name: 'deck', label: 'Deck, bench and stove', x: 590, y: 610 },
      { name: 'sail', label: 'Sail, patches and rigging', x: 600, y: 180 },
    ] },
    { shot: 'island', title: 'Island', see: 'Beached at the landing, loot in reach.', crops: [
      { name: 'beach', label: 'Paddler, crate and sand', x: 900, y: 380 },
      { name: 'hull', label: 'Hull, patches and driftwood', x: 230, y: 560 },
    ] },
    { shot: 'lobby', title: 'Lobby', see: 'Title and menu. The menu is the same in both.', crops: [
      { name: 'scene', label: 'Canoe, steeple and island', x: 900, y: 380 },
    ] },
    { shot: 'settings', title: 'Settings', see: 'Same panel. Two rows moved to match B2: paper grain 60 to 36, and the mist slider now sits on the lighter mist.', crops: [
      { name: 'panel', label: 'Settings rows', x: 960, y: 390 },
    ] },
    { shot: 'pause', title: 'Pause', see: 'Same card, washed-back painting behind it.', crops: [
      { name: 'panel', label: 'Pause card', x: 650, y: 300 },
    ] },
  ],
  big: [
    { shot: 'upgraded', label: 'Upgraded canoe: deck', x: 800, y: 810 },
    { shot: 'play', label: 'Play: island and far shore', x: 900, y: 240 },
  ],
};

const startedAt = Date.now();
const say = (text) => console.log(`[hub] ${text}`);
const read = (path) => readFileSync(path, 'utf8');
const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in values)) throw new Error(`The template asks for {{${key}}} and the build has no value for it.`);
  return values[key];
});
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Remove one of the site's own folders. Refuses anything outside hub/site/. */
function clearSiteFolder(name) {
  const target = join(SITE, name);
  if (relative(SITE, target).startsWith('..')) throw new Error(`Refusing to remove ${target}: not inside hub/site/.`);
  rmSync(target, { recursive: true, force: true });
}

// ---------------------------------------------------------------- hub.json

const hub = JSON.parse(read(join(HUB, 'hub.json')));
const allLinks = hub.sections.flatMap((section) => section.groups.flatMap((group) => group.links));
for (const link of allLinks) {
  for (const field of ['title', 'href', 'see']) {
    if (typeof link[field] !== 'string' || link[field] === '') {
      throw new Error(`hub.json: a link is missing "${field}": ${JSON.stringify(link).slice(0, 120)}`);
    }
  }
}

// ---------------------------------------------------------------- vite apps

async function buildApp({ from, to, pages }) {
  const folder = join(ROOT, from);
  // Each project's own vite, so the build matches what its dev server runs.
  const vite = await import(pathToFileURL(join(folder, 'node_modules/vite/dist/node/index.js')).href);
  const input = Object.fromEntries(pages.map((page) => [page.replace(/\.html$/, ''), join(folder, page)]));
  await vite.build({
    root: folder,
    base: './',
    // Load the project's config by plain import. The default loader writes a temp file into the project.
    configLoader: 'native',
    logLevel: 'warn',
    // The bundles hold three.js. Their size is known, so the size warning is turned off here.
    build: { outDir: join(SITE, to), emptyOutDir: true, chunkSizeWarningLimit: 4000, rollupOptions: { input } },
  });
  say(`${to}/ built from ${from}/ with vite ${vite.version} (${pages.join(', ')})`);
}

// ---------------------------------------------------------------- review page

function copyReview() {
  let html = read(join(ROOT, 'art-r1/review.html'));
  // The review names the three dev servers. From another computer those go nowhere, so link the hub copies.
  for (const [port, path] of Object.entries(DEV_PORTS)) {
    html = html.replaceAll(`<code>localhost:${port}</code>`, `<a href="${path}"><code>${path}</code></a>`);
  }
  // The hub is the way back: the review has no navigation of its own.
  html = html.replace(/<body([^>]*)>/, '<body$1><p style="margin:0;padding:8px 16px;font:14px system-ui,sans-serif"><a href="index.html" style="color:inherit">&larr; Portage hub</a></p>');
  writeFileSync(join(SITE, 'review.html'), html);
  const left = (html.match(/localhost|127\.0\.0\.1|file:\/\//g) ?? []).length;
  say(`review.html copied${left ? ` (WARNING: ${left} localhost or file:// mentions left in it)` : ''}`);
}

// ---------------------------------------------------------------- thumbnails

function makeThumbnails() {
  clearSiteFolder('shots');
  mkdirSync(join(SITE, 'shots'), { recursive: true });
  let count = 0;
  for (const { folder, match, name } of PICTURES) {
    for (const file of readdirSync(folder).sort()) {
      const found = match.exec(file);
      if (!found) continue;
      execFileSync('sips', [
        '-Z', String(THUMBNAIL_LONG_SIDE), '-s', 'format', 'jpeg', '-s', 'formatOptions', '72',
        join(folder, file), '--out', join(SITE, 'shots', name(found)),
      ], { stdio: ['ignore', 'ignore', 'inherit'] });
      count++;
    }
  }
  say(`shots/ ${count} thumbnails`);
}

// ---------------------------------------------------------------- look B against B2

/** One JPEG from a PNG with sips, cropped if asked. */
function jpeg(source, target, quality, crop) {
  if (!existsSync(source)) throw new Error(`compare page: ${source} is missing. Take the screenshots first (see scratch/portage/b2/).`);
  const args = ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality)];
  if (crop) {
    // sips reads an offset of 0 as "not given" and cuts from the centre instead
    if (crop.x < 1 || crop.y < 1) throw new Error(`compare page: crop offsets must be 1 or more, got ${crop.x}, ${crop.y}.`);
    args.push('-c', String(COMPARE.crop.height), String(COMPARE.crop.width), '--cropOffset', String(crop.y), String(crop.x));
  }
  execFileSync('sips', [...args, source, '--out', target], { stdio: ['ignore', 'ignore', 'inherit'] });
}

const LOOK_NAME = { b: 'B', b2: 'B2' };

function sideHtml(look, caption, liveHref, inner) {
  return `<figure class="side${look === 'b2' ? ' new' : ''}"><figcaption><span class="tag">${LOOK_NAME[look]}</span><span>${escapeHtml(caption)}</span>`
    + (liveHref ? `<a href="${escapeHtml(liveHref)}">Open live</a>` : '')
    + `</figcaption>${inner}</figure>`;
}

function buildCompare(css) {
  const metricsPath = join(COMPARE.folder, 'metrics.json');
  if (!existsSync(metricsPath)) throw new Error(`compare page: ${metricsPath} is missing. Run scratch/portage/b2/measure.mjs first.`);
  const metrics = JSON.parse(read(metricsPath));
  const { width, height } = COMPARE.crop;
  let pictures = 0;

  // ---- the six shots: full picture, then 100% crops
  const shots = COMPARE.shots.map(({ shot, title, see, crops }) => {
    const full = ['b', 'b2'].map((look) => {
      const file = `shots/cmp-${look}-${shot}.jpg`;
      jpeg(join(COMPARE.folder, `${look}-${shot}-1080.png`), join(SITE, file), 90);
      pictures++;
      return sideHtml(look, look === 'b' ? 'before' : 'after', `looks/${look}/?shot=${shot}`,
        `<a class="frame" href="${file}"><img src="${file}" width="1920" height="1080" loading="lazy" alt="Look ${LOOK_NAME[look]}, ${escapeHtml(title.toLowerCase())} shot, whole frame"></a>`);
    }).join('');
    const cropRows = crops.map((crop) => {
      const pair = ['b', 'b2'].map((look) => {
        const file = `shots/cmp-${look}-${shot}-${crop.name}.jpg`;
        jpeg(join(COMPARE.folder, `${look}-${shot}-1080.png`), join(SITE, file), 95, crop);
        pictures++;
        return sideHtml(look, 'at 100%', null,
          `<div class="crop" role="group" aria-label="Look ${LOOK_NAME[look]}, ${escapeHtml(crop.label.toLowerCase())}, 100% crop"><img src="${file}" width="${width}" height="${height}" loading="lazy" alt="Look ${LOOK_NAME[look]}: ${escapeHtml(crop.label.toLowerCase())}, at 100%"></div>`);
      }).join('');
      return `    <h4>100% crop: ${escapeHtml(crop.label.toLowerCase())}</h4>\n    <div class="duo">${pair}</div>`;
    }).join('\n');
    return `    <section class="pair" id="shot-${shot}" aria-labelledby="shot-${shot}-heading">\n`
      + `    <h3 id="shot-${shot}-heading">${escapeHtml(title)}</h3>\n    <p class="note">${escapeHtml(see)}</p>\n`
      + `    <div class="duo">${full}</div>\n${cropRows}\n    </section>`;
  }).join('\n');

  // ---- the 2560x1440 pair, crops only
  const big = COMPARE.big.map(({ shot, label, x, y }) => {
    const pair = ['b', 'b2'].map((look) => {
      const file = `shots/cmp-${look}-${shot}-1440.jpg`;
      jpeg(join(COMPARE.folder, `${look}-${shot}-1440.png`), join(SITE, file), 95, { x, y });
      pictures++;
      const drawn = metrics.canvas[look]['2560x1440'].drawn.replace('x', '\u00d7');
      return sideHtml(look, `drawn at ${drawn}`, null,
        `<div class="crop" role="group" aria-label="Look ${LOOK_NAME[look]}, ${escapeHtml(label.toLowerCase())}, 100% crop of a 2560 by 1440 screen"><img src="${file}" width="${width}" height="${height}" loading="lazy" alt="Look ${LOOK_NAME[look]} on a 2560 by 1440 screen: ${escapeHtml(label.toLowerCase())}, at 100%"></div>`);
    }).join('');
    return `    <section class="pair">\n    <h3>${escapeHtml(label)}</h3>\n    <div class="duo">${pair}</div>\n    </section>`;
  }).join('\n');

  // ---- the numbers
  const times = (text) => String(text).replaceAll('x', '\u00d7');
  const rows = [];
  const group = (title) => rows.push(`          <tr class="group"><th scope="colgroup" colspan="4">${escapeHtml(title)}</th></tr>`);
  const row = (what, before, after, means) => rows.push(`          <tr><th scope="row">${escapeHtml(what)}</th><td class="old">${escapeHtml(before)}</td><td class="new">${escapeHtml(after)}</td><td class="means">${escapeHtml(means)}</td></tr>`);

  group('Drawing size (a screen with no pixel doubling)');
  for (const size of ['1920x1080', '2560x1440', '3840x2160']) {
    const before = metrics.canvas.b[size];
    const after = metrics.canvas.b2[size];
    row(`On a ${times(size)} screen`, `${times(before.drawn)} (${Math.round(before.percentOfScreen)}%)`, `${times(after.drawn)} (${Math.round(after.percentOfScreen)}%)`,
      before.percentOfScreen > 99 ? 'Both draw every pixel.' : 'B is stretched to fit, so it goes soft. B2 is not stretched.');
  }
  group('Sharpness, same crop in both');
  const sharp = (key, field) => [metrics.sharpness.b[key][field], metrics.sharpness.b2[key][field]];
  for (const [key, label] of [['island', 'island crop'], ['canoe', 'upgraded canoe crop'], ['canoe1440', `upgraded canoe on a 2560${'\u00d7'}1440 screen`]]) {
    const [before, after] = sharp(key, 'edgeAcutance');
    row(`Edge sharpness, ${label}`, before.toFixed(3), after.toFixed(3), `${after > before ? 'B2 edges are' : 'B edges are'} ${Math.abs(Math.round((after / before - 1) * 100))}% tighter. 1.0 would be a one-pixel edge.`);
  }
  for (const [key, label] of [['island', 'island crop'], ['canoe', 'upgraded canoe crop']]) {
    const [before, after] = sharp(key, 'meanGradient');
    row(`Mean gradient, ${label}`, before.toFixed(2), after.toFixed(2), 'A weak test: B has wider lines and heavier grain, and both add gradient without adding sharpness.');
  }
  group('Detail, same crop in both');
  for (const [key, label] of [['island', 'island crop'], ['canoe', 'upgraded canoe crop']]) {
    const [before, after] = sharp(key, 'edgeLength');
    row(`Line work, ${label}`, `${before.toFixed(1)} per 1000 px`, `${after.toFixed(1)} per 1000 px`, `Drawn edges thinned to one pixel, so a fat line counts the same as a fine one. B2 has ${Math.round((after / before - 1) * 100)}% more.`);
  }
  {
    const [before, after] = sharp('island', 'washTexture');
    row('Texture inside the washes, island crop', before.toFixed(2), after.toFixed(2), 'Higher means more going on inside a flat area. It counts drawn detail and paper grain together, and B2 has less grain.');
  }
  group('Steady');
  row('Pixels changed in 400 ms, land only, still camera', `${metrics.steady.b.changed} of ${metrics.steady.b.of}`, `${metrics.steady.b2.changed} of ${metrics.steady.b2.of}`,
    `Nothing shimmers on land. The test can fail: with line boil forced on, ${metrics.steady.b2BoilOnBreakTest.changed} pixels change.`);
  group('Speed (other 3D pages were running on the same chip: trust the ratio)');
  const ratios = [];
  for (const [key, cost] of Object.entries(metrics.frameCost)) {
    if (key.startsWith('1920x1080')) ratios.push(cost.ratio);
    row(`Frame cost, ${times(key)}`, `${cost.b} ms at ${cost.bDrawn}`, `${cost.b2} ms at ${cost.b2Drawn}`, `B2 costs ${cost.ratio.toFixed(1)} times B.${ratios.length === 1 && key.startsWith('1920x1080') ? ' A 60 fps frame has 16.7 ms to spend.' : ''}`);
  }
  for (const size of ['1920x1080', '2560x1440']) {
    const before = metrics.fps[`b ${size} upgraded`];
    const after = metrics.fps[`b2 ${size} upgraded`];
    if (before && after) row(`Frame-rate readout after 9 s, ${times(size)}`, before, after, 'What each page reports about itself, with its frame-rate ladder free to act.');
  }
  if (ratios.length === 0) throw new Error('compare page: metrics.json has no 1920x1080 frame costs. Run measure.mjs without --quick.');
  const low = Math.min(...ratios);
  const high = Math.max(...ratios);

  writeFileSync(join(SITE, 'compare-b.html'), fill(read(join(HUB, 'src/compare-b.html')), {
    css,
    name: escapeHtml(hub.name),
    measured: escapeHtml(new Date(metrics.when).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })),
    ratio: low.toFixed(1) === high.toFixed(1) ? low.toFixed(1) : `${low.toFixed(1)} to ${high.toFixed(1)}`,
    nav: COMPARE.shots.map(({ shot, title }) => `<a href="#shot-${shot}">${escapeHtml(title)}</a>`).join(''),
    numbers: rows.join('\n'),
    shots,
    big,
    bBig: times(metrics.canvas.b['2560x1440'].drawn),
  }));
  say(`compare-b.html ${pictures} pictures, ${rows.length} table rows`);
  // B and B2 live in two panes of one page. Self-contained, so it is copied as it is.
  copyFileSync(join(HUB, 'src/side-by-side.html'), join(SITE, 'side-by-side.html'));
  say('side-by-side.html');
}

// ---------------------------------------------------------------- docs

/** Links inside a doc: dev-server addresses go to the hub copy, web links stay, Mac file paths become plain text. */
function rewriteDocLink(href) {
  const local = /^https?:\/\/(?:localhost|127\.0\.0\.1):(\d+)\/?(.*)$/.exec(href);
  if (local) return DEV_PORTS[local[1]] ? `../${DEV_PORTS[local[1]]}${local[2]}` : null;
  return /^https?:\/\//.test(href) ? href : null;
}

function buildDocs(css) {
  clearSiteFolder('docs');
  mkdirSync(join(SITE, 'docs'), { recursive: true });
  const template = read(join(HUB, 'src/doc.html'));
  let count = 0;
  for (const link of allLinks.filter((each) => each.from)) {
    if (!/^docs\/[\w-]+\.html$/.test(link.href)) throw new Error(`hub.json: "${link.title}" has "from", so its href must be docs/<name>.html, not ${link.href}`);
    const source = resolve(ROOT, link.from);
    if (!existsSync(source)) throw new Error(`hub.json: "${link.title}" is built from ${source}, which does not exist.`);
    const markdown = read(source);
    writeFileSync(join(SITE, link.href), fill(template, {
      css,
      name: escapeHtml(hub.name),
      title: escapeHtml(firstHeading(markdown) ?? link.title),
      source: escapeHtml(source),
      body: renderMarkdown(markdown, { rewriteLink: rewriteDocLink }),
    }));
    count++;
  }
  say(`docs/ ${count} pages`);
}

// ---------------------------------------------------------------- hub page

function keysHtml(keys) {
  const lines = keys.map((line) => {
    const cut = line.indexOf(':');
    if (cut < 0) return `<li>${escapeHtml(line)}</li>`;
    const names = line.slice(0, cut).split(',').map((name) => `<kbd>${escapeHtml(name.trim())}</kbd>`).join('');
    return `<li>${names} ${escapeHtml(line.slice(cut + 1).trim())}</li>`;
  });
  return `<ul class="keys" aria-label="Keys">${lines.join('')}</ul>`;
}

const linkKind = (link) => (link.thumb ? 'shot' : link.keys ? 'feature' : 'row');

function shotHtml(link) {
  const href = escapeHtml(link.href);
  const also = (link.also ?? []).map((extra) => `<a href="${escapeHtml(extra.href)}">${escapeHtml(extra.title)}</a>`).join(' · ');
  // One link holds the picture and the title, so a keyboard or screen reader meets each target once.
  return `<li><a class="card" href="${href}"><span class="pic"><img src="${escapeHtml(link.thumb)}" alt="" width="480" height="270" loading="lazy"></span>`
    + `<span class="title">${escapeHtml(link.title)}</span></a>`
    + `<p class="see">${escapeHtml(link.see)}</p>`
    + (also ? `<p class="also">${also}</p>` : '')
    + '</li>';
}

const featureHtml = (link) => `<div class="feature"><div><a class="go" href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a>`
  + `<p class="see">${escapeHtml(link.see)}</p></div>${keysHtml(link.keys)}</div>`;

const rowHtml = (link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a><span class="see">${escapeHtml(link.see)}</span></li>`;

/** A group's links in hub.json order. Neighbours of the same kind share one list. */
function linksHtml(links) {
  const html = [];
  for (let at = 0; at < links.length;) {
    const kind = linkKind(links[at]);
    const run = [];
    while (at < links.length && linkKind(links[at]) === kind) run.push(links[at++]);
    if (kind === 'feature') html.push(run.map(featureHtml).join('\n'));
    if (kind === 'shot') html.push(`<ul class="shots">${run.map(shotHtml).join('\n')}</ul>`);
    if (kind === 'row') html.push(`<ul class="rows">${run.map(rowHtml).join('\n')}</ul>`);
  }
  return html.join('\n');
}

function buildHubPage(css) {
  const statusRow = (key, label, emptyText) => {
    const lines = hub.status[key] ?? [];
    const list = lines.length
      ? `<ul>${lines.map((line) => `<li>${typeof line === 'string' ? escapeHtml(line) : `<a href="${escapeHtml(line.href)}">${escapeHtml(line.text)}</a>`}</li>`).join('')}</ul>`
      : `<p class="none">${emptyText}</p>`;
    return `    <div class="row ${key}"><h3>${label}</h3>${list}</div>`;
  };
  // What Luc has to do comes first.
  const status = [
    statusRow('waiting', 'Waiting on Luc', 'Nothing.'),
    statusRow('running', 'Running now', 'Nothing.'),
    statusRow('done', 'Done', 'Nothing yet.'),
  ].join('\n');

  const sections = hub.sections.map((section) => {
    const groups = section.groups.map((group) => '<div class="group">'
      + (group.title ? `<h3>${escapeHtml(group.title)}</h3>` : '')
      + (group.note ? `<p class="note">${escapeHtml(group.note)}</p>` : '')
      + linksHtml(group.links)
      + '</div>').join('\n');
    return `  <section class="section" id="${slug(section.title)}"><h2>${escapeHtml(section.title)}</h2>`
      + (section.note ? `<p class="note">${escapeHtml(section.note)}</p>` : '')
      + `\n${groups}\n  </section>`;
  }).join('\n');

  writeFileSync(join(SITE, 'index.html'), fill(read(join(HUB, 'src/hub.html')), {
    css,
    name: escapeHtml(hub.name),
    pitch: escapeHtml(hub.pitch),
    updated: escapeHtml(hub.updated),
    nav: hub.sections.map((section) => `<a href="#${slug(section.title)}">${escapeHtml(section.title)}</a>`).join(''),
    status,
    sections,
    addresses: hub.addresses.map((address) =>
      `        <li>${escapeHtml(address.label)}: <a href="${escapeHtml(address.url)}"><code>${escapeHtml(address.url)}</code></a></li>`).join('\n'),
    rebuild: escapeHtml(hub.rebuild),
  }));
  say(`index.html ${allLinks.length} links in ${hub.sections.length} sections`);
}

// ---------------------------------------------------------------- run

mkdirSync(SITE, { recursive: true });
for (const app of APPS) await buildApp(app);
copyReview();
makeThumbnails();
const css = read(join(HUB, 'src/style.css')).trim();
buildCompare(css);
buildDocs(css);
buildHubPage(css);
buildWorkbench(SITE, { say });
say(`done in ${((Date.now() - startedAt) / 1000).toFixed(1)} s: ${SITE}`);
