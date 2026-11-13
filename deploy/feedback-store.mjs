// The feedback store's part of a relay deploy. Used by deploy/deploy-relay.sh and deploy/read-feedback.sh.
// It talks to nobody: it reads what wrangler printed and edits the copy of wrangler.jsonc that is uploaded.
//
//   wrangler d1 list --json | node deploy/feedback-store.mjs id <name>
//       Prints the id of the D1 database called <name>. Exit 3: the account has no such database.
//   node deploy/feedback-store.mjs bind <wrangler.jsonc> <id>
//       Puts the id in place of the stand-in the file holds for this computer.
//   node deploy/feedback-store.mjs cut <wrangler.jsonc>
//       Takes the store out of the file: the relay is then uploaded without it and answers "feedback is off".
import { readFileSync, writeFileSync } from 'node:fs';

const [task, ...args] = process.argv.slice(2);
const STAND_IN = 'local-only-portage-feedback';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const stop = (words, code = 1) => {
  console.error(`feedback store: ${words}`);
  process.exit(code);
};

if (task === 'id' && args.length === 1) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let list = null;
  try {
    // Wrangler may print a line or two before the JSON.
    list = JSON.parse(input.slice(Math.max(0, input.indexOf('['))));
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) stop(`could not read the list of databases. It began: ${input.slice(0, 200).replace(/\s+/g, ' ')}`);
  const found = list.find((entry) => entry && entry.name === args[0]);
  if (!found) stop(`the account has no database called ${args[0]}`, 3);
  const id = String(found.uuid ?? found.database_id ?? found.id ?? '');
  if (!ID.test(id)) stop(`the database called ${args[0]} has no id that reads as one`);
  console.log(id);
} else if (task === 'bind' && args.length === 2) {
  const [file, id] = args;
  if (!ID.test(id)) stop(`not a database id: ${id.slice(0, 60)}`);
  const settings = readFileSync(file, 'utf8');
  if (settings.split(`"${STAND_IN}"`).length !== 2) stop(`${file} does not hold the stand-in id exactly once`);
  writeFileSync(file, settings.replace(`"${STAND_IN}"`, `"${id}"`));
} else if (task === 'cut' && args.length === 1) {
  const lines = readFileSync(args[0], 'utf8').split('\n');
  const begin = lines.findIndex((entry) => entry.trim() === '// feedback-store:begin');
  const end = lines.findIndex((entry) => entry.trim() === '// feedback-store:end');
  if (begin < 0 || end <= begin) stop(`${args[0]} has no feedback-store lines to take out`);
  lines.splice(begin, end - begin + 1);
  writeFileSync(args[0], lines.join('\n'));
} else {
  stop('usage: feedback-store.mjs id <name> | bind <wrangler.jsonc> <id> | cut <wrangler.jsonc>', 2);
}
