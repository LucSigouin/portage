# Portage relay

Passes messages between one host and up to three guests, so friends on other computers can share a canoe.
The host's browser still runs the game. The relay only carries frames.

Live since 2026-11-12 as the Cloudflare Worker `portage-relay`, on `sigouin.net/portage/relay/*`.
Deploy it with `bash deploy/deploy-relay.sh --yes`, on Luc's go each time.

## What it is

- A Cloudflare Worker (`src/worker.ts`) with one Durable Object per room.
- The room's rules are plain TypeScript (`src/room.ts`): no Cloudflare in them, so the game's own tests run the same code.
- The dial limit's rules are plain TypeScript too (`src/dial.ts`). The count is kept by Cloudflare's rate limiting binding (`DIALS` in `wrangler.jsonc`).
- WebSockets, taken with the hibernation API: a room nobody talks in costs no running time.
- Pinned to wrangler 4.133.0 (`package.json`). Config: `wrangler.jsonc`.

## What it does and does not do

- Carries the host's messages to one guest or to all, and a guest's to the host. It never reads them.
- Stamps who a guest's frame is from. A guest cannot pose as another, and never hears another.
- Knows who is host, who joined, who left. The host's key gets the room back after a drop. Nobody else's does.
- Stores nothing of the game: no state, no names, no keys on disk. Per live room it keeps one alarm time and the idle count (two small values), removed when the room empties.
- Logs nothing (`observability` is off, and the code has no log line).
- Has no secrets. Nothing to rotate.

## The caps

| Cap | Value | Where |
|---|---|---|
| Players in a room | 4 (1 host, 3 guests) | `MAXIMUM_GUESTS` |
| Frame size | 16 K characters from a guest, 256 K from the host | `LIMITS` |
| Frame rate | 60 a second from a guest, 240 from the host, 2 s of burst | `LIMITS` |
| Idle room | closed after 3 looks with nothing through it (looks are 10 min apart) | `LIMITS.quietSweeps`, `IDLE_SWEEP_SECONDS` |
| Where a connection comes from | On this computer: `https://sigouin.net`, `localhost` and `127.0.0.1` on any port. Live: `https://sigouin.net` alone (the deploy script sets it) | `ALLOWED_ORIGINS` |
| Room codes | 6 characters of `FHJKLMQRTWXY34679`, shown as `FHJ-K3M`: 24 million codes | `ROOM_CODE_ALPHABET` |
| Dials from one address | 30 a minute. An IPv6 address is counted by its first 64 bits. This computer is never limited | `DIALS_PER_MINUTE` in `src/dial.ts`, `ratelimits` in `wrangler.jsonc` |

A socket that breaks a cap is closed, with the reason sent first as a frame. The dial limit is the one cap at the
door: a dial over it gets no socket at all, see below.

## The dial limit

Every other cap is per socket. This one is per address: how often one address may dial a room.

- **The number: 30 dials a minute.** The busiest thing the game itself does is come back after a drop: at most
  18 dials in 45 seconds from one player, and only while the room keeps turning it away. A join is one dial, a
  reload is one dial. So 30 covers one player coming back flat out, a crew of four joining, and a friend who
  reloads eight times, all behind one address in the same minute. `tests/dial.test.ts` does that sum from the
  game's own retry times.
- **Who is counted.** The address Cloudflare reports (`CF-Connecting-IP`), which a script cannot choose. IPv4:
  the address. IPv6: its first 64 bits, because one line at home or one rented server is handed all 2^64 of them.
- **What is counted.** Only a dial that would wake a room. What the door turns away for another reason (another
  site's page, a bad code, another protocol) is not counted, and a refused dial does not add to the count either.
- **What a dial over the limit gets.** Plain HTTP: `429`, the words `too many dials from this address: wait a
  minute`, and `Retry-After: 60`. No socket is opened and no room is woken.
- **What that costs.** One Worker request, which every dial costs anyway, and nothing of the rooms' day: no room
  request, no running time, no storage row. Asking the count is a look at a number Cloudflare keeps beside the
  Worker (their page: "Each check uses a locally cached count"). Neither the rate limiting page nor the pricing
  page names a price for the binding.
- **What the game shows.** A browser cannot read why a handshake was refused, so the game sees a dial that
  failed. On a first dial it tries three times in two seconds and then says "The relay cannot be reached. Check
  your connection and try again." A line that was open keeps trying for 45 seconds, as it does for any drop,
  and gets back in if the minute passes in that time. If not, it ends on the same sentence. Trying again a
  minute later is the right thing to do, so the sentence holds. The game cannot tell this refusal from a relay
  that is down, and no code in the game was changed.
- **If the count cannot be asked** (the binding missing, or failing), the dial is let in. A relay with no limit
  is better than no relay. `deploy/deploy-relay.sh` ends by checking, on the live relay, that the limit works.
- **On this computer** (`127.x.x.x`, `::1`) there is no limit, so the game's own browser tests are never
  stopped. Cloudflare never reports such an address. The tests dial as other addresses to meet the limit.

### What the limit does not stop

It stops a script that dials in a loop, and a game with a bug that does the same. It does not make the free
plan safe from someone who writes a script for this relay. Numbers from the Cost section below:

| What | What it costs |
|---|---|
| One address dialling flat out all day | Held to 30 a minute: 43,200 dials, at most 43,200 of the rooms' 100,000 requests. Before the limit, at 100 dials a second: the whole day in 17 minutes |
| One address that opens a room with every dial and holds it | Each room held to its idle cap costs 4 requests and about 9 storage rows. 30 a minute is 16,200 rows an hour: the day's 100,000 rows are gone in about 6 hours. Before the limit: about 2 minutes |
| One socket at the frame cap | The host's cap is 240 frames a second, which is 12 requests a second: the day in 2 hours 19 minutes. A guest's cap is 60 a second: 9 hours 16 minutes. No redial needed, so the dial limit never sees it |
| One address with 30 host sockets, each at the frame cap | 30 dials is one minute's allowance. 360 requests a second: the day in under 5 minutes |
| Many addresses | Each has its own 30 a minute. Three addresses flat out use up the day by dialling alone. 56 do it in an hour. Someone who holds a bigger IPv6 block has many: a /56 is 256 lines, a /48 is 65,536 |
| The Worker's own requests | Every dial, let in or refused, is one of the account's 100,000 Worker requests a day, shared with Luc's other Workers. Nothing inside a Worker can refuse a request before it is counted. Only a Cloudflare rule in front can (next section) |
| Cloudflare's count is not exact | Their words: "Rate limits are approximate and apply separately in each Cloudflare location. Requests can exceed your configured limit while counts update in the background." One address reaches one location, so that part costs nothing. How many more than 30 get through in a burst is not known until the first deploy's check prints it |

The frame cap rows are the big ones. Closing them means counting frames or live sockets per address, which is a
change to the room's rules: not built, Luc's call.

### The rule in front (Luc's call, his account)

A Cloudflare rate limiting rule sits in front of the Worker, and is the only thing that can protect the
account's 100,000 Worker requests a day. Cloudflare's pages say a request a rule blocks "stops and does not
reach later phases", and that "Only requests that hit a Worker will count against your limits". No page says in
one sentence that a blocked request never counts as a Worker request: that is reasoned from those two, not seen.
It cannot be tested from this computer.

The free plan gives `sigouin.net` one such rule: counted per address, over 10 seconds, blocked for 10 seconds.
That is too coarse to replace the limit above (a script still gets through 60 times a minute), so it goes on top.

1. Cloudflare dashboard, the `sigouin.net` site, **Security**, **Security rules**.
2. **Create rule**, **Rate limiting rules**.
3. Rule name: `portage relay dials`.
4. Field **URI Path**, operator **starts with**, value `/portage/relay/`.
5. With the same characteristics: **IP**.
6. When rate exceeds: **20** requests per **10 seconds**.
7. Then take action: **Block**. Duration: **10 seconds**.
8. **Deploy**.

- Why 20: four players behind one address, all coming back at once, dial 24 times in their first 10 seconds, so
  a full crew in one house can meet it once and is let through again 10 seconds later. One or two players never
  meet it. A script is held to about 60 requests a minute: at most 86,400 Worker requests a day from one address.
- It counts every request under that path, `/health` too. Sockets already open are not touched.
- If the one free rule is already used on `sigouin.net`, this needs the Pro plan or that rule's place.
- After adding it, `deploy/smoke-relay.mjs ... --limit` may be stopped by this rule before the relay's own
  limit. It says which of the two stopped it.

## Run it on this computer

```
npm --prefix relay install --cache /private/tmp/claude-501/portage-npmcache
WRANGLER_SEND_METRICS=false relay/node_modules/.bin/wrangler dev --cwd relay --port 8791 --inspector-port 9291 --show-interactive-dev-session=false
```

- Port 8791 (8787 belongs to another project).
- Check: `curl http://localhost:8791/health` prints `portage relay: ok`, then `build local`.
- The game's dev server passes `/relay` on to it (`game/vite.config.ts`), so the lobby shows "Host a crew" and "Join a crew".
- Never run wrangler from a folder that holds a `.env` file, and give it no token. Local mode needs neither.

## Tests

```
npm --prefix relay run check
```

- `tests/room.test.ts`: the room's rules by themselves. 25 tests.
- `tests/dial.test.ts`: the name an address is counted under, and the sum behind the number 30. 6 tests.
- `tests/worker.test.ts`: the real Worker, run locally by wrangler on ports 8793, 8794 and 8795, dialled with real WebSockets. 20 tests, about 110 s.
  One of them waits 12 s for the room to be put to sleep and checks that it wakes whole.
  One runs the idle cap with looks 13 s apart, longer than the room's sleep, so each look is a new waking: 55 s.
  Five are the dial limit: a script that dials 200 times is let in 30 times, a refused dial never reaches the
  room it dialled, a crew of four behind one address joins, drops, rejoins and reloads ten times with no
  refusal, IPv6 is counted by line, and an address stopped before the tests began is let in again a minute later.
  Three are the build's name: `/health`, `deploy/wait-relay.mjs` and `deploy/smoke-relay.mjs`, each run
  against two local relays with different names.
- The limit's tests dial as addresses from ranges set aside for tests and examples (`198.18.x.x`,
  `2001:db8::`), by sending `CF-Connecting-IP` themselves. Only the local Worker believes that header.
  The addresses are new every run: wrangler's local stand-in for Cloudflare's counter keeps its counts on disk
  (`.wrangler/`), and a fixed address would bring the last run's dials into the next one.
- Wrangler's local stand-in for Cloudflare's counter starts a new count when the clock's minute turns. The tests
  that count dials wait for the turn when it is less than 15 s away. Cloudflare does not say where its own
  windows start.
- The game's side: `game/tests/net/relay.test.ts` and `game/tests/client/crewlobby.test.ts` (both ends against `src/room.ts`, in memory), and `e2e/tests/relay.spec.ts` (two browser profiles through this Worker).

### The browser spec

Needs the game's dev server (port 5222 here) and this relay (8791). Seven tests. Two of them each need a built game
served by `vite preview`, and are skipped (not passed) without it:

```
game/node_modules/.bin/vite build game --outDir <folder>/dist-norelay --emptyOutDir
PORTAGE_RELAY=/relay game/node_modules/.bin/vite build game --outDir <folder>/dist-relay --emptyOutDir
game/node_modules/.bin/vite preview game --outDir <folder>/dist-norelay --port 5226 --strictPort
game/node_modules/.bin/vite preview game --outDir <folder>/dist-relay --port 5227 --strictPort
PORTAGE_URL=http://localhost:5222 PORTAGE_BARE_URL=http://localhost:5226 PORTAGE_BUILT_URL=http://localhost:5227 \
  PORTAGE_HEADERS=<sigouin-net>/site/_headers RELAY_SHOTS=<folder>/shots \
  npm --prefix e2e test -- relay.spec.ts --global-timeout=540000
```

- `PORTAGE_BARE_URL`: the build with no relay. No crew entries, no socket, an invite link ignored.
- `PORTAGE_BUILT_URL` and `PORTAGE_HEADERS`: the build with the relay, under the live site's security policy.
- `RELAY_SHOTS`: eleven pictures at 1920x1080.
- Run it alone, with nothing else heavy on the machine. On a 16 GB Mac with its swap nearly full, a third game
  window at 1920x1080 stalled everything for twenty seconds and two tests failed on "Connecting to the relay…".
  The spec now opens two big windows at most, and small ones (800x450) for the four-player test.

## The one setting in the game

`PORTAGE_RELAY`, read when the game is built.

| Value | Result |
|---|---|
| not set | No relay. No crew entries in the lobby and no socket ever opened. The bundle has no socket code and no crew lobby in it (the words of the two cards stay, out of reach). |
| `/portage/relay` | The relay on the site's own host. The site's security policy needs no change. This is what `deploy/deploy.sh` builds. |
| `wss://relay.example` | The relay somewhere else. The site's `connect-src` must name it. |

The dev server uses `/relay`.

## The deploy (Luc's go each time)

```
bash deploy/deploy-relay.sh --yes
```

The script, in order:

1. Runs this package's tests. A red relay does not go live.
2. Copies `relay/` to an empty folder and runs `wrangler deploy` there, signed in by the browser login only
   (`deploy/login.sh` when it has expired). Never the token in `personal/.env`: wrangler reads a `.env` from the
   folder it runs in, so it never runs in one that has it.
3. Gives wrangler three things that are not in `wrangler.jsonc`: the route `sigouin.net/portage/relay/*`,
   `ALLOWED_ORIGINS` set to `https://sigouin.net` alone, and `BUILD`, this upload's name: the commit and the
   time, such as `78b15bf-20261113T140000Z`. So the file stays the one for this computer and its tests.
4. Waits for the new relay (`deploy/wait-relay.mjs`). `/health` prints two lines: `portage relay: ok`, then
   `build <name>`. The relay from before says the first line just as well, so the script waits up to two
   minutes for the second line to name this upload, three times in a row.
5. Runs `deploy/smoke-relay.mjs` against the live relay, and only against this build: a host and a guest meet
   in a room, a message goes each way, a second host with another key is turned away, the host closes the room,
   and four strangers are refused (two other sites, no page at all, and `localhost`).
6. The same run then tries the dial limit on Cloudflare itself: it dials in a loop, each time a code nobody
   opened, until the door answers 429 (it gives up at 150), then waits until the address is let in again (up
   to 90 s). It prints at which dial it was stopped and how long the wait was. This adds about a minute, and
   for that minute Luc's own address cannot dial the relay.
7. Checks the live game page is byte for byte what it was.

Everything that reads `/health` reads its first line only, except the two that want the build:
`deploy/deploy.sh` (first line), `deploy/wait-relay.mjs` and `deploy/smoke-relay.mjs --build` (both lines),
`tests/support.ts` (the status).

The first deploy of the dial limit is also the first time the `ratelimits` setting goes to Cloudflare from
this Worker. If the upload refuses it, step 2 stops and names the upload, and nothing later runs.

Where it lives, and why: on the site's own host. The live site's policy (`sigouin-net/site/_headers`) says
`connect-src 'self' blob:`. A socket to the site's own host is `'self'`, so the policy and the site stay as they
are. `e2e/tests/relay.spec.ts` proves that with the real `_headers` file, and proves the socket is stopped when
`'self'` is taken out. A Worker route does sit in front of a Cloudflare Pages site: settled by the first deploy
(2026-11-12), where the health address answered as the relay and every other page kept its hash.

The game uses the relay when it is built with `PORTAGE_RELAY=/portage/relay`, which `deploy/deploy.sh` does. That
script refuses to build while the relay does not answer, and ends by putting two headless browsers in one canoe
on the live site (`deploy/smoke-crew.mjs`).

To undo: from an empty folder, `<portage>/relay/node_modules/.bin/wrangler delete --name portage-relay` (browser
login). Then take `PORTAGE_RELAY` and the three relay checks out of `deploy/deploy.sh` and deploy the game. The
lobby goes back to five entries.

Not built: a cap on frames or on live sockets per address. The dial limit (the review's fix 13) is built, and
"What the limit does not stop" above says what is left: a script written for this relay can still use up the free
plan's day, and the relay would then be off until midnight UTC. Also not built: the Cloudflare rule in front,
which is a setting on Luc's account and written out above.

## Cost

Figures read from Cloudflare's own pages on 2026-11-11 and read again twice on 2026-11-12 (Durable Objects pricing, last updated Oct 18, 2026; Workers limits, last updated Oct 29, 2026). Same numbers each time.

- Workers Free: 100,000 requests a day for the account. Durable Objects on Free: 100,000 requests and 13,000 GB-s of running time a day. Resets at 00:00 UTC.
- A WebSocket frame coming in counts as 1/20 of a request. Frames going out are free. Opening a socket is one request. Running time is charged at 128 MB while a room is awake, and not while it sleeps.
- Measured through this Worker with four players paddling (`e2e/tests/relay.spec.ts` prints it): host 18 frames a second, each guest 15 to 19. All four: 64 to 73 a second over six runs (69 and 71 on 2026-11-12).
- One hour, four players, at 73: 262,800 frames, 13,140 requests (13% of the day), 461 GB-s (3.5% of the day).
- So the free plan carries about 7.5 hours of four-player play a day, or about 16 hours with two players.
- The idle cap writes at most three small rows every ten minutes a room is open (the alarm, the count, and a mark that a frame went through), and reads one each time a room wakes. The free plan allows 100,000 rows written a day: nothing.
- Past the limit, Cloudflare's words: "further operations of that type will fail with an error". The relay stops until midnight UTC.
- The Free plan also allows 10 ms of processor time a request. The relay does a few string operations a frame. Local mode does not enforce that limit, so it is not measured here.
- Where a connection comes from is only as honest as a browser. A script can lie about it. The caps are what protect the relay.
- A dial that reaches a room is one room request, whether the room seats it or turns it away. A dial the door refuses (the dial limit, another site's page, a bad code) is none: it never gets to a room.
- A dial of either kind is one Worker request. Cloudflare's rate limiting page (last updated Nov 12, 2026) and Workers pricing page (Oct 2, 2026) were read on 2026-11-13: the binding's count is per Cloudflare location, approximate, a window is 10 or 60 seconds, and neither page names a price for it.
- The rule in front, on the free plan (Cloudflare's rate limiting rules page, last updated Aug 25, 2026): one rule, counted per address, 10 seconds counted, 10 seconds blocked, matched on the path. Its counts are per Cloudflare data center too (their request rate page, last updated Apr 16, 2026).
- Not said on either page: whether the rooms' 100,000 requests are the same 100,000 as the account's Workers. Count on the worst: an hour of four players takes 13% of what Luc's other Workers have that day.
