// Portage hub check. Exits 1, with every fault listed, if the built site would fail from another computer.
//
//   node /Users/ls/Claude-Workspace/personal/portage/hub/check.mjs [--site <folder>]
//
// It fails when:
//   1. a link or thumbnail in hub.json points at something missing from hub/site/, or is not a relative path
//      (a status line that links to "#looks" must match a section on the hub page)
//   2. index.html contains "localhost", "127.0.0.1" or "file://"
//   3. a built page, stylesheet or script asks for an asset by an absolute root path ("/assets/x.js"),
//      which breaks under a sub-path such as /looks/a/
//   4. the site holds a symbolic link (it could reach outside hub/site/)
//   5. the markdown step stops producing the pieces the docs pages need
//   6. compare-b.html names a picture or page that is missing, shows too few pictures, or still holds a
//      "localhost" address or an unfilled {{placeholder}}
// --site checks a copy of the site instead. The break-tests use it, so the live folder is never damaged.
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from './src/markdown.mjs';

const HUB = dirname(fileURLToPath(import.meta.url));
const siteFlag = process.argv.indexOf('--site');
const SITE = siteFlag >= 0 && process.argv[siteFlag + 1] ? resolve(process.argv[siteFlag + 1]) : join(HUB, 'site');

const faults = [];
const fault = (text) => faults.push(text);

// ---- 1. every hub.json link and thumbnail exists in the site

const hub = JSON.parse(readFileSync(join(HUB, 'hub.json'), 'utf8'));
const targets = [];
for (const section of hub.sections) {
  for (const group of section.groups) {
    for (const link of group.links) {
      const where = `${section.title} > ${link.title}`;
      targets.push({ where, field: 'href', path: link.href });
      if (link.thumb) targets.push({ where, field: 'thumb', path: link.thumb });
      for (const extra of link.also ?? []) targets.push({ where: `${where} > ${extra.title}`, field: 'href', path: extra.href });
    }
  }
}

// A status line may be a link too. "#looks" must be a section on the hub page: checked in step 2.
const anchors = [];
for (const [list, lines] of Object.entries(hub.status)) {
  for (const line of lines) {
    if (typeof line === 'string') continue;
    if (typeof line.href === 'string' && line.href.startsWith('#')) anchors.push({ where: `status > ${list}`, id: line.href.slice(1) });
    else targets.push({ where: `status > ${list} > ${line.text}`, field: 'href', path: line.href });
  }
}

/** The file a site-relative link lands on, the way a static server resolves it. */
function fileFor(path) {
  const clean = path.split(/[?#]/)[0];
  const full = join(SITE, clean);
  if (relative(SITE, full).startsWith('..')) return null;
  if (clean === '' || clean.endsWith('/') || (existsSync(full) && statSync(full).isDirectory())) return join(full, 'index.html');
  return full;
}

for (const { where, field, path } of targets) {
  if (typeof path !== 'string' || path === '') { fault(`hub.json: "${where}" has no ${field}.`); continue; }
  if (/^[a-z][a-z0-9+.-]*:|^\/|^\\/i.test(path)) {
    fault(`hub.json: "${where}" ${field} is "${path}". It must be relative to the site root, like "game/" or "docs/brief.html".`);
    continue;
  }
  const file = fileFor(path);
  if (!file || !existsSync(file) || !statSync(file).isFile()) {
    fault(`hub.json: "${where}" ${field} "${path}" points at nothing. Missing: ${file ?? 'a path outside the site'}`);
  }
}

// ---- 2. the hub page names no address that only works on the Mac

const indexPath = join(SITE, 'index.html');
if (!existsSync(indexPath)) {
  fault(`index.html is missing from ${SITE}. Run build.mjs first.`);
} else {
  const index = readFileSync(indexPath, 'utf8');
  for (const banned of ['localhost', '127.0.0.1', 'file://']) {
    const at = index.indexOf(banned);
    if (at >= 0) fault(`index.html contains "${banned}": ...${index.slice(Math.max(0, at - 60), at + 60).replace(/\s+/g, ' ')}...`);
  }
  for (const { where, id } of anchors) {
    if (!index.includes(` id="${id}"`)) fault(`hub.json: "${where}" links to #${id}, and the hub page has no section with that id.`);
  }
}

// ---- 3 and 4. no absolute root asset paths, no symbolic links

function walk(folder) {
  const files = [];
  if (!existsSync(folder)) return files;
  for (const name of readdirSync(folder)) {
    const full = join(folder, name);
    const stats = lstatSync(full);
    if (stats.isSymbolicLink()) fault(`${relative(SITE, full)} is a symbolic link. The site must hold plain files only.`);
    else if (stats.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

// A leading "/" followed by a second "/" is a protocol-relative web address, not a root path. Those are left alone.
const ROOT_PATH_PATTERNS = {
  '.html': [
    /\b(?:src|href|poster|action|data)\s*=\s*["']\/(?!\/)[^"']*["']/g,
    /\bsrcset\s*=\s*["'][^"']*(?:^|[\s,"'])\/(?!\/)[^"']*["']/g,
    /url\(\s*["']?\/(?!\/)[^)]*\)/g,
  ],
  '.css': [/url\(\s*["']?\/(?!\/)[^)]*\)/g, /@import\s+["']\/(?!\/)[^"']*["']/g],
  '.js': [
    /["'`]\/(?:assets|src|public|shots|looks|game|docs)\/[^"'`\s]*["'`]/g,
    /["'`]\/[\w./-]+\.(?:js|mjs|css|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|mp3|ogg|wav|json|wasm|glb|gltf|bin|ktx2|hdr)["'`]/g,
  ],
};

const siteFiles = walk(SITE);
for (const file of siteFiles) {
  const extension = /\.[a-z0-9]+$/i.exec(file)?.[0].toLowerCase();
  const patterns = ROOT_PATH_PATTERNS[extension];
  if (!patterns) continue;
  const text = readFileSync(file, 'utf8');
  const found = new Set();
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) found.add(match[0].slice(0, 100));
  for (const each of found) fault(`${relative(SITE, file)} asks for an absolute root path, which breaks under a sub-path: ${each}`);
}

// ---- 5. the markdown step still makes what the docs need

const sample = renderMarkdown([
  '# Title', '', 'Some **bold** text, `code`, [a link](http://example.com/x) and <b>raw html</b>.', '',
  '- one', '  - nested', '- two', '', '1. first', '2. second', '',
  '| a | b |', '|---|---|', '| `x | y` | 2 |', '', '```', 'if (a < b) {}', '```', '', '> quoted',
].join('\n'));
const expected = [
  '<h1>Title</h1>', '<strong>bold</strong>', '<code>code</code>', '<a href="http://example.com/x">a link</a>',
  '&lt;b&gt;raw html&lt;/b&gt;', '<ul><li>one\n<ul><li>nested</li></ul></li><li>two</li></ul>', '<ol><li>first</li><li>second</li></ol>',
  '<th>a</th><th>b</th>', '<td><code>x | y</code></td><td>2</td>', '<pre><code>if (a &lt; b) {}</code></pre>', '<blockquote><p>quoted</p></blockquote>',
];
for (const piece of expected) if (!sample.includes(piece)) fault(`markdown step: expected ${piece} in the rendered sample and did not find it.`);

// ---- 6. the comparison page names no picture or page that is missing

const comparePath = join(SITE, 'compare-b.html');
if (!existsSync(comparePath)) {
  fault(`compare-b.html is missing from ${SITE}. Run build.mjs first.`);
} else {
  const compare = readFileSync(comparePath, 'utf8');
  const named = new Set([...compare.matchAll(/\b(?:src|href)="([^"#][^"]*)"/g)].map((found) => found[1]).filter((path) => !/^[a-z][a-z0-9+.-]*:/i.test(path)));
  let pictures = 0;
  for (const path of named) {
    const file = fileFor(path.replaceAll('&amp;', '&'));
    if (!file || !existsSync(file) || !statSync(file).isFile()) fault(`compare-b.html names "${path}", which is missing: ${file ?? 'a path outside the site'}`);
    else if (/\.jpg$/.test(path)) {
      pictures++;
      if (statSync(file).size < 10_000) fault(`compare-b.html picture "${path}" is only ${statSync(file).size} bytes: it did not come out of the build as a real picture.`);
    }
  }
  if (pictures < 20) fault(`compare-b.html shows ${pictures} pictures. It should show the six shots and their crops for both looks.`);
  for (const banned of ['localhost', '127.0.0.1', 'file://', '{{']) {
    if (compare.includes(banned)) fault(`compare-b.html contains "${banned}".`);
  }
}

// ---- verdict

if (faults.length > 0) {
  console.error(`[hub check] FAIL: ${faults.length} fault${faults.length === 1 ? '' : 's'} in ${SITE}`);
  for (const each of faults) console.error(`  - ${each}`);
  process.exit(1);
}
console.log(`[hub check] OK: ${targets.length} links and thumbnails resolve, index.html is clean, ${siteFiles.length} files scanned in ${SITE}`);
