// Smoke test of the public feedback page, on a phone-sized screen.
// Mode "local": serves the build from disk under a made-up origin with sigouin.net's security headers, so the
// policy is tested before anything is deployed. Mode "live": the real address.
//   node smoke-feedback.mjs local <dist folder> <_headers file> [break]   |   node smoke-feedback.mjs live https://sigouin.net/portage/
// "break" forbids every script in the local policy: the test must then fail.
// The page is read twice: once as a browser reads it, once with scripts off. Both must show every note.
// The plan too: every job of hub/feedback.json has its card, every open note links to its job, and every link
// inside the page has somewhere to land, also when the filter has put its note away.
import { readFileSync, existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { chromium } from '/Users/ls/Claude-Workspace/personal/portage/e2e/node_modules/@playwright/test/index.mjs';
const [mode, target, headersFile, breakIt] = process.argv.slice(2);
const stop = (why) => { console.error(`smoke-feedback: ${why}`); console.log('FEEDBACK FAIL'); process.exit(1); };
if ((mode !== 'local' && mode !== 'live') || !target || (mode === 'local' && !headersFile)) {
  stop('usage: node smoke-feedback.mjs local <dist folder> <_headers file> [break]   |   node smoke-feedback.mjs live https://sigouin.net/portage/');
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.jpg': 'image/jpeg' };
// What the page must show is worked out from the words beside this script, as the build works it out.
const words = JSON.parse(readFileSync(new URL('../hub/feedback.json', import.meta.url), 'utf8'));
const want = {
  notes: words.notes.filter((note) => note.state !== 'check').length,
  handled: words.notes.filter((note) => note.state === 'handled').length,
  open: words.notes.filter((note) => note.state === 'open').length,
  checks: words.notes.filter((note) => note.state === 'check').length,
};
// The plan, as the page must show it: each job with its notes, and the open notes that must each name a job.
const plan = {
  jobs: (words.plan?.jobs ?? []).map((job) => ({ id: job.id, notes: job.notes })),
  open: words.notes.filter((note) => note.state === 'open').map((note) => note.n),
};
want.jobs = plan.jobs.length;
want.fixes = plan.jobs.reduce((sum, job) => sum + job.notes.length, 0);

let base = target;
let policy = '';
if (mode === 'local') {
  base = 'https://portage.test/portage/';
  const policyLine = readFileSync(headersFile, 'utf8').split('\n').find((line) => line.trim().startsWith('Content-Security-Policy:'));
  if (!policyLine) stop(`no "Content-Security-Policy:" line in ${headersFile}: there is no policy to test the page under.`);
  policy = policyLine.trim().slice('Content-Security-Policy:'.length).trim();
  if (breakIt === 'break') {
    const broken = policy.replace("script-src 'self'", "script-src 'none'");
    if (broken === policy) stop(`"break" found no "script-src 'self'" to swap in ${headersFile}: nothing was broken, so nothing was proven.`);
    policy = broken;
  }
}
const origin = new URL(base).origin;
const problems = [];
const offOrigin = [];

// One reader of the page: a phone-sized screen, the local routes and policy, and ears for complaints.
async function reader(browser, name, javaScriptEnabled) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, javaScriptEnabled });
  if (mode === 'local') {
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://portage.test' || !url.pathname.startsWith('/portage/')) return route.abort();
      const relative = url.pathname.slice('/portage/'.length) || 'index.html';
      // Cloudflare Pages serves feedback.html at /portage/feedback.
      const file = join(target, extname(relative) ? relative : `${relative}.html`);
      if (!existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, body: readFileSync(file), headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': policy, 'x-content-type-options': 'nosniff' } });
    });
  }
  const page = await context.newPage();
  page.on('console', (message) => { if (message.type() === 'error' || message.type() === 'warning') problems.push(`${name}${message.type()}: ${message.text()}`); });
  page.on('pageerror', (error) => problems.push(`${name}pageerror: ${error.message}`));
  page.on('request', (request) => { if (new URL(request.url()).origin !== origin && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) offOrigin.push(`${name}${request.url()}`); });
  const answer = await page.goto(`${base}feedback`).catch((error) => { problems.push(`${name}the page did not open: ${error.message.split('\n')[0]}`); return null; });
  return { page, status: answer ? answer.status() : 0 };
}
// Which notes are put away. A note counts as hidden only if it is marked hidden and takes no room on the page.
const shown = (page) => page.evaluate(() => {
  const tally = (selector) => {
    const all = [...document.querySelectorAll(selector)];
    return { count: all.length, hidden: all.filter((note) => note.hidden && note.getClientRects().length === 0).length, seen: all.filter((note) => !note.hidden && note.getClientRects().length > 0).length };
  };
  return { handled: tally('#notes .note.is-handled'), open: tally('#notes .note.is-open'), all: tally('#notes .note') };
});
// The plan on the page: which job cards are there and show, which links between jobs and notes are missing,
// and which links inside the page point at nothing.
const planOf = (page) => page.evaluate((plan) => {
  const cards = [...document.querySelectorAll('#plan .job')];
  const ids = cards.map((card) => card.id);
  const faults = [];
  for (const job of plan.jobs) {
    if (!ids.includes(`job-${job.id}`)) faults.push(`the plan's job "${job.id}" has no card on the page`);
    for (const number of job.notes) {
      if (!document.querySelector(`#job-${job.id} .job-notes a[href="#note-${number}"]`)) faults.push(`job "${job.id}" has no link to note ${number}`);
      if (!document.querySelector(`#note-${number}.is-open .fix a[href="#job-${job.id}"]`)) faults.push(`open note ${number} has no planned-fix link to job "${job.id}"`);
    }
  }
  for (const id of ids) if (!plan.jobs.some((job) => `job-${job.id}` === id)) faults.push(`the page has a job card "${id}" that is not in the plan`);
  for (const number of plan.open) if (!document.querySelector(`#note-${number} .fix a[href^="#job-"]`)) faults.push(`open note ${number} names no planned fix`);
  for (const note of document.querySelectorAll('#notes .note:not(.is-open)')) if (note.querySelector('.fix')) faults.push(`${note.id} is not open and shows a planned fix`);
  const inside = [...document.querySelectorAll('a[href^="#"]')].map((link) => link.getAttribute('href'));
  for (const href of new Set(inside)) if (!document.getElementById(href.slice(1))) faults.push(`a link goes to ${href}, which is not on the page`);
  return {
    jobs: cards.length,
    jobsSeen: cards.filter((card) => !card.hidden && card.getClientRects().length > 0).length,
    fixes: document.querySelectorAll('#notes .note .fix a[href^="#job-"]').length,
    inside: inside.length,
    faults,
  };
}, plan);
const sidewaysOf = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const browser = await chromium.launch({ headless: true });

// First reading: as a browser reads it.
const { page, status } = await reader(browser, '', true);
await page.evaluate(() => document.fonts.ready);
const seen = await page.evaluate(() => {
  const count = (selector) => document.querySelectorAll(selector).length;
  const figure = (name) => (document.querySelector(`#counts [data-count="${name}"]`)?.textContent ?? '').trim();
  // A note's words are crossed out when they hold an <s> with words in it and no word outside one.
  const uncrossed = [...document.querySelectorAll('#notes .note.is-handled')].filter((note) => {
    const said = note.querySelector('.said');
    if (!said || ![...said.querySelectorAll('s')].some((strike) => strike.textContent.trim() !== '')) return true;
    const rest = said.cloneNode(true);
    for (const strike of rest.querySelectorAll('s')) strike.remove();
    return rest.textContent.trim() !== '';
  }).map((note) => note.id || '(no id)');
  const wronglyCrossed = [...document.querySelectorAll('#notes .note.is-open')].filter((note) => !note.querySelector('.said') || note.querySelector('.said s')).map((note) => note.id || '(no id)');
  const ids = [...document.querySelectorAll('#notes .note')].map((note) => note.id);
  const numbers = ids.map((id) => (/^note-(\d+)$/.test(id) ? Number(id.slice('note-'.length)) : NaN));
  return {
    notes: count('#notes .note'), handled: count('#notes .note.is-handled'), open: count('#notes .note.is-open'), checks: count('#checks .check'),
    total: figure('total'), handledSaid: figure('handled'), openSaid: figure('open'), version: figure('version'),
    uncrossed, wronglyCrossed,
    newestFirst: numbers.length > 0 && numbers.every((number, index) => Number.isInteger(number) && (index === 0 || number < numbers[index - 1])),
  };
});
const planSeen = await planOf(page);
const fonts = await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').length);
const sideways = await sidewaysOf(page);
// Every link that stays on this site must answer. (Links to other sites are not followed.)
const links = await page.evaluate(async (site) => {
  const hrefs = [...new Set([...document.querySelectorAll('a[href]')].map((link) => link.href).filter((href) => href.startsWith(`${site}/`) && !href.includes('#')))];
  const dead = [];
  for (const href of hrefs) {
    const code = await fetch(href).then((reply) => reply.status, () => 0);
    if (code !== 200) dead.push(`${code} ${href}`);
  }
  return { count: hrefs.length, dead };
}, origin);
// The page's script is served as a file. It brings out the filter, which is hidden in the HTML.
const scriptRan = await page.waitForFunction(() => { const filter = document.getElementById('filter'); return Boolean(filter) && filter.hidden === false; }, null, { timeout: 5000 }).then(() => true, () => false);
// Press "open": every handled note goes away and no open one does. Press "all": every note is back.
const filterFaults = [];
if (scriptRan) {
  const press = (show) => page.click(`#filter [data-show="${show}"]`, { timeout: 5000 }).then(() => true, (error) => { filterFaults.push(`the "${show}" button could not be pressed: ${error.message.split('\n')[0]}`); return false; });
  if (await press('open')) {
    const after = await shown(page);
    if (after.handled.hidden !== after.handled.count) filterFaults.push(`after "open": ${after.handled.count - after.handled.hidden} of ${after.handled.count} handled notes still show`);
    if (after.open.seen !== after.open.count) filterFaults.push(`after "open": ${after.open.count - after.open.seen} of ${after.open.count} open notes are hidden`);
  }
  if (await press('all')) {
    const after = await shown(page);
    if (after.all.seen !== after.all.count) filterFaults.push(`after "all": ${after.all.count - after.all.seen} of ${after.all.count} notes are hidden`);
  }
  // Press "handled": the open notes go away, the plan stays. A job's link to its note must still land, twice over:
  // the second press of the same link changes no hash.
  const job = plan.jobs[0];
  if (job && await press('handled')) {
    const after = await planOf(page);
    if (after.jobsSeen !== want.jobs) filterFaults.push(`after "handled": ${after.jobsSeen} of ${want.jobs} job cards show: the filter must leave the plan alone`);
    const target = `#note-${job.notes[0]}`;
    const link = `#job-${job.id} .job-notes a[href="${target}"]`;
    // The browser tells the page of a new hash a moment after the press, so the look waits a little.
    const lands = () => page.waitForFunction((selector) => { const note = document.querySelector(selector); return Boolean(note) && !note.hidden && note.getClientRects().length > 0 && location.hash === selector; }, target, { timeout: 3000 }).then(() => true, () => false);
    const follow = (time) => page.click(link, { timeout: 5000 }).then(lands, () => false).then((landed) => { if (!landed) filterFaults.push(`after "handled": the ${time} press of job "${job.id}"'s link did not land on ${target}`); });
    await follow('first');
    if (await press('handled')) await follow('second');
    await press('all');
  }
} else {
  filterFaults.push('the filter never came out of hiding, so its buttons were not pressed');
}
const filterWorks = filterFaults.length === 0;

// Second reading: scripts off. Every note is there to read and the filter stays put away.
const plain = await reader(browser, 'scripts off: ', false);
const plainSeen = await shown(plain.page);
const plainFilterHidden = await plain.page.evaluate(() => { const filter = document.getElementById('filter'); return Boolean(filter) && filter.hidden && filter.getClientRects().length === 0; });
const plainPlan = await planOf(plain.page);
const plainSideways = await sidewaysOf(plain.page);
await browser.close();

const versionOk = /^1\.0\.\d+$/.test(seen.version);
const countsOk = seen.total === String(want.notes) && seen.handledSaid === String(want.handled) && seen.openSaid === String(want.open);
console.log(`${mode} feedback: status ${status}, ${seen.notes} of ${want.notes} notes (${seen.handled} of ${want.handled} handled, ${seen.open} of ${want.open} open), `
  + `${seen.handled - seen.uncrossed.length} of ${want.handled} handled crossed out (${seen.wronglyCrossed.length} open crossed out), `
  + `${planSeen.jobs} of ${want.jobs} jobs of the plan, ${planSeen.fixes} of ${want.fixes} planned-fix links, ${planSeen.inside} links inside the page (${planSeen.faults.length} plan faults), `
  + `counts say ${seen.total || '?'} total ${seen.handledSaid || '?'} handled ${seen.openSaid || '?'} open, version ${seen.version || '?'}, ${seen.checks} of ${want.checks} deploy checks, newest first ${seen.newestFirst}, `
  + `fonts loaded ${fonts}, ${links.count} links on this site answer (${links.dead.length} dead), ${sideways} px of sideways scroll, script ran ${scriptRan}, filter works ${filterWorks}, `
  + `off-origin requests ${offOrigin.length}, console problems ${problems.length}; scripts off: status ${plain.status}, ${plainSeen.all.seen} of ${want.notes} notes show, ${plainPlan.jobsSeen} of ${want.jobs} jobs show, filter hidden ${plainFilterHidden}, ${plainSideways} px of sideways scroll`);
const lines = [
  ...(status === 200 ? [] : [`the page answered ${status}, not 200`]),
  ...(seen.notes === want.notes && seen.handled === want.handled && seen.open === want.open ? [] : [`the page holds ${seen.notes} notes (${seen.handled} handled, ${seen.open} open): the words give ${want.notes} (${want.handled} handled, ${want.open} open)`]),
  ...(want.jobs > 0 ? [] : ['hub/feedback.json has no plan with jobs in it']),
  ...(planSeen.jobs === want.jobs && planSeen.jobsSeen === want.jobs ? [] : [`the page holds ${planSeen.jobs} job cards and shows ${planSeen.jobsSeen}: the plan gives ${want.jobs}`]),
  ...(planSeen.fixes === want.fixes ? [] : [`the notes hold ${planSeen.fixes} planned-fix links: the plan gives ${want.fixes}`]),
  ...planSeen.faults.map((fault) => `plan: ${fault}`),
  ...(plainPlan.jobsSeen === want.jobs && plainPlan.fixes === want.fixes && plainPlan.faults.length === 0 ? [] : [`scripts off: ${plainPlan.jobsSeen} of ${want.jobs} job cards show, ${plainPlan.fixes} of ${want.fixes} planned-fix links, ${plainPlan.faults.length} plan faults`]),
  ...(seen.checks === want.checks ? [] : [`the page holds ${seen.checks} deploy checks: the words give ${want.checks}`]),
  ...(fonts >= 2 ? [] : [`only ${fonts} fonts loaded: at least 2 must`]),
  ...(sideways <= 0 ? [] : [`the page scrolls ${sideways} px sideways on a 390 px screen`]),
  ...(plain.status === 200 ? [] : [`scripts off: the page answered ${plain.status}, not 200`]),
  ...(plainSeen.all.count === want.notes && plainSeen.all.seen === want.notes ? [] : [`scripts off: ${plainSeen.all.seen} of ${plainSeen.all.count} notes show: the words give ${want.notes}`]),
  ...(plainFilterHidden ? [] : ['scripts off: the filter shows, with no script to work it']),
  ...(plainSideways <= 0 ? [] : [`scripts off: the page scrolls ${plainSideways} px sideways on a 390 px screen`]),
  ...seen.uncrossed.map((id) => `handled but not all crossed out: ${id}`),
  ...seen.wronglyCrossed.map((id) => `open but crossed out, or with no words: ${id}`),
  ...(countsOk ? [] : [`the counts say ${seen.total || '?'} total, ${seen.handledSaid || '?'} handled, ${seen.openSaid || '?'} open: the words give ${want.notes}, ${want.handled}, ${want.open}`]),
  ...(versionOk ? [] : [`the version reads "${seen.version}", not 1.0.N`]),
  ...(seen.newestFirst ? [] : ['the notes are not newest first: the ids note-N must fall down the page']),
  ...links.dead.map((link) => `dead link: ${link}`),
  ...filterFaults.map((fault) => `filter: ${fault}`),
  ...offOrigin.map((url) => `off-origin: ${url}`),
  ...problems,
];
for (const line of lines) console.log(`  ${line}`);
const planOk = want.jobs > 0 && planSeen.jobs === want.jobs && planSeen.jobsSeen === want.jobs && planSeen.fixes === want.fixes && planSeen.faults.length === 0
  && plainPlan.jobsSeen === want.jobs && plainPlan.fixes === want.fixes && plainPlan.faults.length === 0;
const ok = planOk && status === 200 && seen.notes === want.notes && seen.handled === want.handled && seen.open === want.open
  && seen.uncrossed.length === 0 && seen.wronglyCrossed.length === 0 && countsOk && versionOk && seen.checks === want.checks && seen.newestFirst
  && fonts >= 2 && links.dead.length === 0 && sideways <= 0 && scriptRan && filterWorks && offOrigin.length === 0 && problems.length === 0
  && plain.status === 200 && plainSeen.all.count === want.notes && plainSeen.all.seen === want.notes && plainFilterHidden && plainSideways <= 0;
console.log(ok ? 'FEEDBACK PASS' : 'FEEDBACK FAIL');
process.exit(ok ? 0 : 1);
