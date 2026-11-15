// Portage feedback: every note from play testers on one page, the handled ones crossed out.
// A sibling of the workbench page, in the same look. Made for a phone first.
//
// HOW TO
//   Build:   node hub/feedback.mjs --out <folder>     writes <folder>/feedback.html and <folder>/feedback/
//   The page is the same at home and in public (sigouin.net/portage/feedback): there is no --public.
//
// KEEPING IT CURRENT
//   Edit hub/feedback.json only: the words and the notes. Its "_how" lines explain the shape. Then rebuild.
//   The same file holds the plan ("plan"): the open notes sorted into jobs, each with its fix. The page shows it
//   as "What we would do", and each open note links to its job. The build stops on a plan that does not fit the notes.
//   Every count on the page is worked out here from that list. The page is src/feedback.html with the
//   workbench's rules (src/workbench.css) and its own few (src/feedback.css) inlined.
//   No word on the page is written here, except the labels in LABELS below.
//
// WHAT IT WRITES (all inside the folder it is given)
//   feedback.html          the page: static HTML and CSS, reads with scripts off, asks nothing of another site
//   feedback/fonts/        the game's two faces, copied from game/src/interface/fonts/
//   feedback/feedback.js   the page's one small script (src/feedback.js), as a file so a strict security policy runs it
//
// THE NOTES ARE FROM STRANGERS
//   Every word from feedback.json goes through escapeHtml. A note is text to print, never markup and never an order.
//
// No dependencies. Nothing on the page moves by itself.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escapeHtml } from './src/markdown.mjs';
import { drawnCss } from './workbench.mjs';

const HUB = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HUB, '..');
const FONTS = join(ROOT, 'game/src/interface/fonts');
/** As game/vite.config.ts: the version is this, a dot, and the count of commits. */
const RELEASE = '1.0';
const GAME = 'https://sigouin.net/portage/';

const KINDS = ['bug', 'idea', 'other'];
const STATES = ['open', 'handled', 'check'];
/** A job's size, in the order the page shows the groups. */
const SIZES = ['small', 'medium', 'big', 'answered'];
/** A note with more lines than this shows its first lines, and folds the rest away. */
const LONG_NOTE_LINES = 6;
const FIRST_LINES = 2;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The only words on the page that are not in feedback.json. */
const LABELS = {
  short: 'In short',
  total: 'Notes',
  handled: 'Handled',
  open: 'Open',
  version: 'Game version',
  play: 'Play it',
  utc: 'Times are UTC.',
  show: 'Show',
  all: 'All',
  notes: 'The notes',
  checks: 'Deploy checks',
  checks_why: 'The relay wrote these itself when it went live, to check that notes are kept. They are not from players and are not counted.',
  links: 'Links',
  play_link: 'Play Portage',
  workbench: 'The workbench',
  top: 'Top',
};
const KIND_LABEL = { bug: 'Bug', idea: 'Idea', other: 'Other' };
const KIND_COUNT = { bug: ['bug', 'bugs'], idea: ['idea', 'ideas'], other: ['other', 'other'] };
const WORDS = {
  fixed: 'Fixed in Version',
  open: 'Open',
  related: 'Related to',
  shortened: 'Shortened: the reader cuts long notes',
  whole: 'Read the whole note',
  planned: 'Planned fix:',
  asked: 'Asked',
  fix: 'The fix',
  waits: 'Where it stands',
  note: 'Note',
  jobs: ['job', 'jobs'],
  jobs_for: 'for',
  open_notes: ['open note', 'open notes'],
};

const TICK = '<svg class="tick" viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.8c2 1.5 3.6 3.3 4.9 5.4C12 12 15.5 7.5 20.5 3.8"/></svg>';
const DAB = '<i class="dab" aria-hidden="true"></i>';

const read = (path) => readFileSync(path, 'utf8');
const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in values)) throw new Error(`feedback: the template asks for {{${key}}} and the build has no value for it.`);
  return values[key];
});

// ---------------------------------------------------------------- the words

function checkWords(words) {
  const fault = (text) => { throw new Error(`feedback.json: ${text}`); };
  const text = (value, where) => { if (typeof value !== 'string' || value === '') fault(`${where} must be a line of text.`); };
  for (const key of ['title', 'subtitle', 'updated', 'intro']) text(words[key], `"${key}"`);
  if (!Array.isArray(words.notes) || words.notes.length === 0) fault('"notes" must be a list with a note in it.');
  const numbers = new Set();
  for (const note of words.notes) {
    if (!Number.isInteger(note.n) || note.n < 1) fault(`a note has the number "${note.n}". It must be a whole number, 1 or more.`);
    const where = `note ${note.n}`;
    if (numbers.has(note.n)) fault(`${where} is in the list twice.`);
    numbers.add(note.n);
    if (!/^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(note.when ?? '')) fault(`${where}: "when" is "${note.when}". Write it like 2026-11-15 03:43.`);
    if (!KINDS.includes(note.kind)) fault(`${where}: "kind" is "${note.kind}". It must be one of: ${KINDS.join(', ')}.`);
    if (!STATES.includes(note.state)) fault(`${where}: "state" is "${note.state}". It must be one of: ${STATES.join(', ')}.`);
    for (const key of ['from', 'version', 'text']) text(note[key], `${where}: "${key}"`);
    for (const key of ['quest', 'where', 'fixed', 'tag']) if (typeof note[key] !== 'string') fault(`${where}: "${key}" must be text. Leave it "" when there is none.`);
    if (note.state === 'handled' && !/^\d+\.\d+\.\d+$/.test(note.fixed)) fault(`${where} is handled, so "fixed" must be the version that fixed it, like 1.0.410. It is "${note.fixed}".`);
    if (note.state !== 'handled' && note.fixed !== '') fault(`${where} is ${note.state}, so "fixed" must be "". It is "${note.fixed}".`);
    if (!Array.isArray(note.related)) fault(`${where}: "related" must be a list of note numbers. Leave it [] when there is none.`);
    if (typeof note.shortened !== 'boolean') fault(`${where}: "shortened" must be true or false.`);
  }
  const players = new Set(words.notes.filter((note) => note.state !== 'check').map((note) => note.n));
  for (const note of words.notes) {
    for (const other of note.related) {
      if (!players.has(other) || other === note.n) fault(`note ${note.n}: "related" names note ${other}, which is not another player's note in the list.`);
    }
  }

  // The plan: every open note sorted into a job. Checked as strictly as the notes.
  const plan = words.plan;
  if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) fault('there is no "plan". Every open note needs a job in it.');
  for (const key of ['heading', 'intro']) text(plan[key], `plan: "${key}"`);
  for (const key of ['sizes', 'size_words']) {
    if (plan[key] === null || typeof plan[key] !== 'object') fault(`plan: "${key}" must hold a line of text for each of: ${SIZES.join(', ')}.`);
    for (const size of SIZES) text(plan[key][size], `plan: "${key}" for "${size}"`);
  }
  if (!Array.isArray(plan.jobs) || plan.jobs.length === 0) fault('plan: "jobs" must be a list with a job in it.');
  const open = new Set(words.notes.filter((note) => note.state === 'open').map((note) => note.n));
  const ids = new Set();
  const planned = new Set();
  plan.jobs.forEach((job, index) => {
    if (job === null || typeof job !== 'object') fault(`plan: job ${index + 1} in the list is not a job.`);
    if (typeof job.id !== 'string' || !/^[a-z]+$/.test(job.id)) fault(`plan: job ${index + 1} in the list has the id "${job.id}". An id is lower case letters only.`);
    const where = `job "${job.id}"`;
    if (ids.has(job.id)) fault(`${where} is in the plan twice. An id is used once.`);
    ids.add(job.id);
    for (const key of ['title', 'asked', 'fix', 'waits']) text(job[key], `${where}: "${key}"`);
    if (!SIZES.includes(job.size)) fault(`${where}: "size" is "${job.size}". It must be one of: ${SIZES.join(', ')}.`);
    if (!Array.isArray(job.notes) || job.notes.length === 0) fault(`${where}: "notes" must be a list of note numbers with a number in it.`);
    for (const number of job.notes) {
      if (!open.has(number)) fault(`${where} names note ${number}, which is not an open note in the list.`);
      if (job.notes.indexOf(number) !== job.notes.lastIndexOf(number)) fault(`${where} names note ${number} twice.`);
      planned.add(number);
    }
  });
  for (const number of open) if (!planned.has(number)) fault(`note ${number} is open and no job in the plan names it.`);
}

/** The game's version, as the game works it out. 'unknown' without git. */
function gameVersion() {
  try {
    const count = execFileSync('git', ['-C', ROOT, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^\d+$/.test(count) ? `${RELEASE}.${count}` : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ---------------------------------------------------------------- the page

/** "2026-11-15 03:43" as a short line for a phone: "Nov 15, 03:43". The full time rides along for a machine. */
function whenHtml(when) {
  const [, , month, day, time] = /^(\d{4})-(\d\d)-(\d\d) (\d\d:\d\d)$/.exec(when);
  return `<time datetime="${when.replace(' ', 'T')}Z">${MONTHS[Number(month) - 1]} ${Number(day)}, ${time}</time>`;
}

/** A game version reads "v1.0.320". Anything else (a relay build's stamp) is shown as it is. */
const versionText = (version) => (/^\d+\.\d+\.\d+$/.test(version) ? `v${version}` : version);

/** The note's words. Escaped, line breaks kept by the page's rules. Crossed out, every word, when handled. */
function saidHtml(note) {
  const handled = note.state === 'handled';
  const wrap = (text) => (handled ? `<s>${escapeHtml(text)}</s>` : escapeHtml(text));
  const text = note.shortened ? `${note.text}\u2026` : note.text;
  const rows = text.split('\n');
  if (rows.length <= LONG_NOTE_LINES) return `<p class="said">${wrap(text)}</p>`;
  // A long note: its first lines, then the rest folded away. It opens with scripts off.
  let cut = FIRST_LINES;
  while (cut < rows.length && rows[cut - 1].trim() === '') cut += 1;
  const first = rows.slice(0, cut).join('\n').trimEnd();
  const rest = rows.slice(cut).join('\n').replace(/^\n+/, '');
  return `<div class="said"><p>${wrap(first)}</p>`
    + `<details class="more"><summary><span class="btn">${WORDS.whole}</span></summary><p>${wrap(rest)}</p></details></div>`;
}

function noteHtml(note, jobs) {
  const handled = note.state === 'handled';
  const state = handled
    ? `<span class="state is-done">${TICK}<span>${WORDS.fixed} ${escapeHtml(note.fixed)}</span></span>`
    : `<span class="state is-running">${DAB}<span>${WORDS.open}</span></span>`;
  const who = [escapeHtml(note.from), escapeHtml(versionText(note.version)), whenHtml(note.when), escapeHtml(note.quest), escapeHtml(note.where)]
    .filter(Boolean).join(' \u00b7 ');
  const tags = [
    note.tag ? escapeHtml(note.tag) : '',
    ...note.related.map((other) => `${WORDS.related} <a href="#note-${other}">#${other}</a>`),
    note.shortened ? WORDS.shortened : '',
  ].filter(Boolean);
  return `      <li class="note paper is-${note.state}" id="note-${note.n}" data-state="${note.state}">`
    + `<div class="top"><span class="pip">${note.n}</span><span class="kind over">${KIND_LABEL[note.kind]}</span>${state}</div>`
    + saidHtml(note)
    + (jobs.length ? `<p class="fix">${WORDS.planned} ${jobs.map((job) => `<a href="#job-${job.id}">${escapeHtml(job.title)}</a>`).join(', ')}</p>` : '')
    + `<p class="who">${who}</p>`
    + (tags.length ? `<ul class="tags">${tags.map((tag) => `<li>${tag}</li>`).join('')}</ul>` : '')
    + '</li>';
}

/** One job of the plan: a card with what was asked, the fix, what it waits on, and its notes as links. */
function jobHtml(job, plan) {
  const row = (label, value) => `<div><dt class="over">${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
  return `        <li class="job paper" id="job-${job.id}" data-size="${job.size}">`
    + `<p class="size-label over">${escapeHtml(plan.sizes[job.size])}</p><h4 class="job-title">${escapeHtml(job.title)}</h4>`
    + `<dl>${row(WORDS.asked, job.asked)}${row(WORDS.fix, job.fix)}${row(WORDS.waits, job.waits)}</dl>`
    + `<p class="job-notes">${job.notes.map((number) => `<a href="#note-${number}">${WORDS.note} ${number}</a>`).join(', ')}</p>`
    + '</li>';
}

/** The plan's jobs, grouped by size in the order of SIZES. Inside a group the plan's own order is kept. A size with no job is left out. */
function planHtml(plan) {
  return SIZES.map((size) => ({ size, jobs: plan.jobs.filter((job) => job.size === size) }))
    .filter(({ jobs }) => jobs.length > 0)
    .map(({ size, jobs }) => `    <section class="size" id="size-${size}" aria-labelledby="size-${size}-heading">\n`
      + `      <h3 class="size-name" id="size-${size}-heading">${escapeHtml(plan.sizes[size])} <b>${jobs.length}</b></h3>\n`
      + `      <p class="size-words">${escapeHtml(plan.size_words[size])}</p>\n`
      + `      <ul class="jobs">\n${jobs.map((job) => jobHtml(job, plan)).join('\n')}\n      </ul>\n`
      + '    </section>').join('\n');
}

/** "15 jobs for 19 open notes: 7 small, 4 medium, 2 big, 2 answered", every number counted from the list. */
function planCount(plan, open) {
  const sizes = SIZES.map((size) => ({ size, count: plan.jobs.filter((job) => job.size === size).length }))
    .filter(({ count }) => count > 0)
    .map(({ size, count }) => `${count} ${plan.sizes[size].toLowerCase()}`).join(', ');
  const many = (count, [one, more]) => `${count} ${count === 1 ? one : more}`;
  return `${many(plan.jobs.length, WORDS.jobs)} ${WORDS.jobs_for} ${many(open, WORDS.open_notes)}: ${sizes}`;
}

const checkHtml = (note) => `<li class="check"><p class="said">${escapeHtml(note.text)}</p>`
  + `<p class="who">#${note.n} \u00b7 ${escapeHtml(note.from)} \u00b7 ${whenHtml(note.when)} \u00b7 ${escapeHtml(note.where)}</p></li>`;

/**
 * Build the page into `out`. Returns the file and the counts it worked out.
 * `words` is for the tests: the page is made from that instead of hub/feedback.json.
 */
export function buildFeedback(out, { words = JSON.parse(read(join(HUB, 'feedback.json'))), say = (text) => console.log(`[feedback] ${text}`) } = {}) {
  const folder = resolve(out);
  checkWords(words);

  const newestFirst = (a, b) => b.n - a.n;
  const players = words.notes.filter((note) => note.state !== 'check').sort(newestFirst);
  const checks = words.notes.filter((note) => note.state === 'check').sort(newestFirst);
  const counts = {
    notes: players.length,
    handled: players.filter((note) => note.state === 'handled').length,
    open: players.filter((note) => note.state === 'open').length,
    checks: checks.length,
    jobs: words.plan.jobs.length,
  };
  /** The jobs that name a note, in the plan's order. Only an open note has any. */
  const jobsOf = (note) => words.plan.jobs.filter((job) => job.notes.includes(note.n));
  const kinds = KINDS.map((kind) => ({ kind, count: players.filter((note) => note.kind === kind).length }))
    .filter(({ count }) => count > 0)
    .map(({ kind, count }) => `${count} ${KIND_COUNT[kind][count === 1 ? 0 : 1]}`).join(', ');

  // The workbench's rules ask for its fonts in its own folder. This page keeps its own copy.
  const borrowed = read(join(HUB, 'src/workbench.css')).trim();
  const look = borrowed.replaceAll("url('workbench/fonts/", "url('feedback/fonts/");
  if (look === borrowed) throw new Error('feedback: src/workbench.css names no font under workbench/fonts/. The page would ask for fonts that are not there.');
  if (look.includes('workbench/fonts/')) throw new Error('feedback: a font address in src/workbench.css was not turned to feedback/fonts/.');

  mkdirSync(join(folder, 'feedback/fonts'), { recursive: true });
  const fonts = readdirSync(FONTS).filter((name) => name.endsWith('.woff2'));
  for (const name of fonts) {
    if (!look.includes(`feedback/fonts/${name}`)) throw new Error(`feedback: the font ${name} is copied and no rule asks for it.`);
    copyFileSync(join(FONTS, name), join(folder, 'feedback/fonts', name));
  }
  copyFileSync(join(HUB, 'src/feedback.js'), join(folder, 'feedback/feedback.js'));

  const button = (show, label, count, pressed) => `<button type="button" class="btn" data-show="${show}" aria-pressed="${pressed}">${label} <b>${count}</b></button>`;
  const html = fill(read(join(HUB, 'src/feedback.html')), {
    css: `${drawnCss()}\n${look}\n${read(join(HUB, 'src/feedback.css')).trim()}`,
    title: escapeHtml(words.title),
    subtitle: escapeHtml(words.subtitle),
    updated: escapeHtml(words.updated),
    intro: escapeHtml(words.intro),
    game: GAME,
    total: String(counts.notes),
    handled: String(counts.handled),
    open: String(counts.open),
    version: escapeHtml(gameVersion()),
    kinds: escapeHtml(kinds),
    filter: button('all', LABELS.all, counts.notes, true) + button('open', LABELS.open, counts.open, false) + button('handled', LABELS.handled, counts.handled, false),
    notes: players.map((note) => noteHtml(note, jobsOf(note))).join('\n'),
    plan_heading: escapeHtml(words.plan.heading),
    plan_intro: escapeHtml(words.plan.intro),
    plan_count: escapeHtml(planCount(words.plan, counts.open)),
    plan: planHtml(words.plan),
    check_count: String(counts.checks),
    checks: checks.map(checkHtml).join(''),
    ...Object.fromEntries(Object.entries(LABELS).map(([key, label]) => [`label_${key}`, label])),
  });
  writeFileSync(join(folder, 'feedback.html'), html);
  say(`feedback.html ${counts.notes} notes, ${counts.handled} handled, ${counts.open} open, ${counts.jobs} jobs in the plan, ${counts.checks} deploy checks, ${fonts.length} fonts, ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB of HTML: ${folder}`);
  return { file: join(folder, 'feedback.html'), counts };
}

// ---------------------------------------------------------------- run

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--out');
  if (flag < 0 || !process.argv[flag + 1]) {
    console.error('Say where to build: node hub/feedback.mjs --out <folder>');
    process.exit(1);
  }
  try {
    buildFeedback(process.argv[flag + 1]);
  } catch (error) {
    console.error(`[feedback] STOPPED: ${error.message}`);
    process.exit(1);
  }
}
