/**
 * The relay deploy's choice of feedback store (deploy/deploy-relay.sh), run dry (the master review of round 3,
 * finding 10): with FEEDBACK=off the script must not ask Cloudflare for the list of databases, so a list that
 * cannot be had does not stop the relay going out.
 *
 * The lines of the script between its two marks are run by bash exactly as they stand, with a stand-in for
 * wrangler that only writes down what it was asked and answers as told. Nothing here reaches Cloudflare, nothing
 * is uploaded, and the real script is never run.
 * Run: npm test
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');
const SCRIPT = readFileSync(join(ROOT, 'deploy', 'deploy-relay.sh'), 'utf8');
const BEGIN = '# feedback-store-choice:begin';
const END = '# feedback-store-choice:end';
const STORE_ID = '0f1e2d3c-4b5a-4978-8a6b-5c4d3e2f1a0b';

/** The script's own lines that choose the store, cut out between its two marks. */
function choice(): string {
  const begin = SCRIPT.indexOf(BEGIN);
  const end = SCRIPT.indexOf(END);
  assert.ok(begin > 0 && end > begin, 'deploy-relay.sh has its two marks');
  return SCRIPT.slice(begin, end);
}

interface Outcome {
  code: number;
  out: string;
  /** What the stand-in wrangler was asked, one line a call. */
  asked: string[];
  /** The settings file that would be uploaded. */
  settings: string;
  log: string;
}

/**
 * Run the store choice. `list`: what `wrangler d1 list --json` prints, or `fail` for a wrangler that cannot list
 * (a login that ran out). `given`: FEEDBACK_DATABASE_ID in front of the script.
 */
function run(feedback: string, list: string | 'fail', given = ''): Outcome {
  const work = mkdtempSync(join(tmpdir(), 'portage-deploy-store-'));
  const stage = join(work, 'stage');
  mkdirSync(stage);
  copyFileSync(join(ROOT, 'relay', 'wrangler.jsonc'), join(stage, 'wrangler.jsonc'));
  const asked = join(work, 'asked.txt');
  writeFileSync(asked, '');
  const wrangler = join(work, 'wrangler');
  writeFileSync(wrangler, list === 'fail'
    ? `#!/bin/bash\necho "$*" >> "${asked}"\necho "You are not logged in. Set CLOUDFLARE_API_TOKEN." >&2\nexit 1\n`
    : `#!/bin/bash\necho "$*" >> "${asked}"\ncat "${join(work, 'list.json')}"\n`);
  chmodSync(wrangler, 0o755);
  if (list !== 'fail') writeFileSync(join(work, 'list.json'), list);
  const harness = [
    'set -euo pipefail',
    `ROOT=${JSON.stringify(ROOT)}`, `WORK=${JSON.stringify(work)}`, `LOG=${JSON.stringify(join(work, 'log.txt'))}`, `STAGE=${JSON.stringify(stage)}`,
    `WRANGLER=${JSON.stringify(wrangler)}`, 'FEEDBACK_STORE=portage-feedback', `FEEDBACK=${JSON.stringify(feedback)}`,
    ': > "$LOG"',
    'fail() { printf \'STOPPED: %s\\n\' "$1"; exit 1; }',
    choice(),
    'printf \'check=%s\\nwords=%s\\nid=%s\\n\' "$feedback_check" "$feedback_words" "$store_id"',
  ].join('\n');
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: work, TMPDIR: work };
  if (given) env.FEEDBACK_DATABASE_ID = given;
  const done = spawnSync('bash', ['-c', harness], { encoding: 'utf8', env });
  return {
    code: done.status ?? -1, out: `${done.stdout}${done.stderr}`,
    asked: readFileSync(asked, 'utf8').split('\n').filter(Boolean),
    settings: readFileSync(join(stage, 'wrangler.jsonc'), 'utf8'),
    log: existsSync(join(work, 'log.txt')) ? readFileSync(join(work, 'log.txt'), 'utf8') : '',
  };
}

const WITH_STORE = JSON.stringify([{ uuid: 'aaaaaaaa-1111-4222-8333-444444444444', name: 'something-else' }, { uuid: STORE_ID, name: 'portage-feedback' }]);
const WITHOUT_STORE = JSON.stringify([{ uuid: 'aaaaaaaa-1111-4222-8333-444444444444', name: 'something-else' }]);
const hasStore = (settings: string): boolean => settings.includes('"NOTES_DB"');

describe('the relay deploy chooses its feedback store', () => {
  it('the script holds the choice between its two marks, once, and reads as bash', () => {
    assert.equal(SCRIPT.split(BEGIN).length, 2);
    assert.equal(SCRIPT.split(END).length, 2);
    assert.match(choice(), /d1 list --json/);
    assert.equal(spawnSync('bash', ['-n', join(ROOT, 'deploy', 'deploy-relay.sh')], { encoding: 'utf8' }).status, 0);
  });

  it('FEEDBACK=off: no list of databases is asked for, so a wrangler that cannot list stops nothing', () => {
    for (const off of ['off', 'OFF', ' Off ']) {
      const done = run(off, 'fail');
      assert.equal(done.code, 0, `${off}: ${done.out}`);
      assert.deepEqual(done.asked, [], `${off}: wrangler was asked nothing`);
      // The relay goes out without the store: it then answers every note "feedback is off", which the smoke test checks.
      assert.equal(hasStore(done.settings), false);
      assert.match(done.out, /^check=off$/m);
      assert.match(done.out, /^words=feedback off: the databases were not looked up, the relay goes out without the store, and what is stored stays$/m);
      assert.match(done.out, /^id=$/m);
    }
  });

  it('FEEDBACK=off with a database that is there: still no look-up, and the same upload', () => {
    const done = run('off', WITH_STORE);
    assert.equal(done.code, 0, done.out);
    assert.deepEqual(done.asked, []);
    assert.equal(hasStore(done.settings), false);
    assert.match(done.out, /^check=off$/m);
  });

  it('FEEDBACK=off with the id given by hand: the store is bound, nothing is looked up, and the check is still "off"', () => {
    const done = run('off', 'fail', STORE_ID);
    assert.equal(done.code, 0, done.out);
    assert.deepEqual(done.asked, []);
    assert.ok(done.settings.includes(`"database_id": "${STORE_ID}"`));
    assert.match(done.out, /^check=off$/m);
    assert.match(done.out, /^words=feedback store portage-feedback 0f1e2d3c, feedback off$/m);
  });

  it('FEEDBACK=on: the list is asked for once, and the store it names is bound', () => {
    const done = run('on', WITH_STORE);
    assert.equal(done.code, 0, done.out);
    assert.deepEqual(done.asked, ['d1 list --json']);
    assert.ok(done.settings.includes(`"database_id": "${STORE_ID}"`));
    assert.equal(done.settings.includes('local-only-portage-feedback'), false);
    assert.match(done.out, /^check=on$/m);
    assert.match(done.out, /^words=feedback store portage-feedback 0f1e2d3c, feedback on$/m);
  });

  it('FEEDBACK=on and no such database: the relay goes out without a store, and the check is "off"', () => {
    const done = run('on', WITHOUT_STORE);
    assert.equal(done.code, 0, done.out);
    assert.deepEqual(done.asked, ['d1 list --json']);
    assert.equal(hasStore(done.settings), false);
    assert.match(done.out, /^check=off$/m);
    assert.match(done.out, /^words=no database called portage-feedback on the account, so feedback is off/m);
  });

  it('FEEDBACK=on and a list that cannot be had, or cannot be read: the deploy still stops, as before', () => {
    const failed = run('on', 'fail');
    assert.equal(failed.code, 1);
    assert.match(failed.out, /^STOPPED: Could not list the account's databases\./m);
    assert.deepEqual(failed.asked, ['d1 list --json']);
    // Nothing was changed in the upload.
    assert.ok(failed.settings.includes('local-only-portage-feedback'));
    const unread = run('on', '<html>Sign in</html>');
    assert.equal(unread.code, 1);
    assert.match(unread.out, /^STOPPED: The list of databases could not be read\./m);
    // The id by hand gets past a list that cannot be had, as the script says.
    const byHand = run('on', 'fail', STORE_ID);
    assert.equal(byHand.code, 0, byHand.out);
    assert.deepEqual(byHand.asked, []);
    assert.match(byHand.out, /^check=on$/m);
  });
});
