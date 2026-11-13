// Waits until the relay at an address is the build just uploaded, and not the one that was there before.
//
//   node deploy/wait-relay.mjs <health address> <build> [seconds to wait]
//   node deploy/wait-relay.mjs https://sigouin.net/portage/relay/health 78b15bf-20261113T140000Z
//
// The relay's /health answers two lines: `portage relay: ok`, then `build <name>`. An old relay answers
// the first line just as well, so the first line proves nothing after a second deploy. This waits for the
// second line to name the new build, three times in a row: Cloudflare can serve the old and the new side
// by side for a moment. Exit 0 when the new build answers, 1 when the wait runs out.
const [address, build, secondsText] = process.argv.slice(2);
const seconds = secondsText === undefined ? 120 : Number(secondsText);
if (!address || !build || !/^https?:\/\//.test(address) || !Number.isFinite(seconds) || seconds <= 0) {
  console.error('usage: node wait-relay.mjs <http:// or https:// health address> <build> [seconds to wait]');
  process.exit(2);
}

const IN_A_ROW = 3;
const BETWEEN = 1000;
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** What the address says right now, as one line of words. */
async function ask() {
  try {
    const answer = await fetch(`${address}${address.includes('?') ? '&' : '?'}fresh=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const lines = (await answer.text()).split('\n').map((line) => line.trim());
    if (answer.status !== 200 || lines[0] !== 'portage relay: ok') return { build: null, said: `${answer.status}: ${lines.join(' / ').slice(0, 80)}` };
    const named = /^build (\S+)$/.exec(lines[1] ?? '');
    return { build: named ? named[1] : null, said: named ? `build ${named[1]}` : 'a relay that names no build (one from before builds were named)' };
  } catch (error) {
    return { build: null, said: `no answer (${error.cause?.code ?? error.name})` };
  }
}

const began = Date.now();
const heard = [];
let row = 0;
for (;;) {
  const answer = await ask();
  if (heard.at(-1) !== answer.said) heard.push(answer.said);
  row = answer.build === build ? row + 1 : 0;
  if (row >= IN_A_ROW) break;
  if (Date.now() - began > seconds * 1000) {
    console.error(`relay build: NOT the new one. Wanted build ${build}. After ${seconds} s ${address} still says: ${answer.said}`);
    process.exit(1);
  }
  await pause(BETWEEN);
}
const before = heard.slice(0, -1);
console.log(`relay build: ${build} answers at ${address}, ${IN_A_ROW} times in a row, after ${((Date.now() - began) / 1000).toFixed(1)} s`
  + `${before.length > 0 ? ` (before it: ${before.join(', then ')})` : ''}`);
