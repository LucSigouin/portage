// Builds the asset viewer as a page of its own, for https://sigouin.net/portage-assets/.
//   node deploy/build-assets.mjs <out folder> [dev-links]
// The game's own build leaves the viewer out (game/viewer.html is not one of its inputs). This asks Vite for
// that one page, with its files addressed under /portage-assets/, and names it index.html: the folder's front page.
// VITE_PORTAGE_GAME tells the page it is a published copy and where the live game is (game/src/viewer/rooms.ts).
// "dev-links" leaves that out, for break-testing the smoke test: the page then keeps its dev-server links.
import { existsSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build } from '/Users/ls/Claude-Workspace/personal/portage/game/node_modules/vite/dist/node/index.js';

const GAME = '/Users/ls/Claude-Workspace/personal/portage/game';
if (!process.argv[2]) {
  console.error('Say where to build: node deploy/build-assets.mjs <out folder>');
  process.exit(1);
}
const out = resolve(process.argv[2]);
if (process.argv[3] !== 'dev-links') process.env.VITE_PORTAGE_GAME = '/portage/';

await build({
  root: GAME,
  base: '/portage-assets/',
  logLevel: 'warn',
  build: { outDir: out, emptyOutDir: true, rollupOptions: { input: join(GAME, 'viewer.html') } },
});
if (!existsSync(join(out, 'viewer.html'))) {
  console.error('The build made no viewer.html.');
  process.exit(1);
}
renameSync(join(out, 'viewer.html'), join(out, 'index.html'));
console.log(`built the asset viewer: ${out}`);
