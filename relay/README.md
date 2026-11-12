# Portage relay

Passes messages between one host and up to three guests, so friends on other computers can share a canoe.
The host's browser still runs the game. The relay only carries frames.

Not deployed. It runs on this computer only, until Luc says go.

## What it is

- A Cloudflare Worker (`src/worker.ts`) with one Durable Object per room.
- The room's rules are plain TypeScript (`src/room.ts`): no Cloudflare in them, so the game's own tests run the same code.
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
| Where a connection comes from | `https://sigouin.net`, `localhost` and `127.0.0.1` on any port | `ALLOWED_ORIGINS` |
| Room codes | 6 characters of `FHJKLMQRTWXY34679`, shown as `FHJ-K3M`: 24 million codes | `ROOM_CODE_ALPHABET` |

A socket that breaks a cap is closed, with the reason sent first as a frame.

## Run it on this computer

```
npm --prefix relay install --cache /private/tmp/claude-501/portage-npmcache
WRANGLER_SEND_METRICS=false relay/node_modules/.bin/wrangler dev --cwd relay --port 8791 --inspector-port 9291 --show-interactive-dev-session=false
```

- Port 8791 (8787 belongs to another project).
- Check: `curl http://localhost:8791/health` prints `portage relay: ok`.
- The game's dev server passes `/relay` on to it (`game/vite.config.ts`), so the lobby shows "Host a crew" and "Join a crew".
- Never run wrangler from a folder that holds a `.env` file, and give it no token. Local mode needs neither.

## Tests

```
npm --prefix relay run check
```

- `tests/room.test.ts`: the room's rules by themselves. 25 tests.
- `tests/worker.test.ts`: the real Worker, run locally by wrangler on ports 8793, 8794 and 8795, dialled with real WebSockets. 11 tests, about 75 s.
  One of them waits 12 s for the room to be put to sleep and checks that it wakes whole.
  One runs the idle cap with looks 13 s apart, longer than the room's sleep, so each look is a new waking: 55 s.
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
| not set | No relay. No crew entries in the lobby and no socket ever opened. The bundle has no socket code and no crew lobby in it (the words of the two cards stay, out of reach). This is what `deploy/deploy.sh` builds today. |
| `/portage/relay` | The relay on the site's own host. The site's security policy needs no change. |
| `wss://relay.example` | The relay somewhere else. The site's `connect-src` must name it. |

The dev server uses `/relay`.

## What a deploy needs (Luc's go first)

Recommended: the relay on the site's own host, on the route `sigouin.net/portage/relay/*`.

Why: the live site's policy (`sigouin-net/site/_headers`) says `connect-src 'self' blob:`. A socket to the site's
own host is `'self'`, so the policy and the site stay as they are. `e2e/tests/relay.spec.ts` proves that with the
real `_headers` file, and proves the socket is stopped when `'self'` is taken out.

The one thing no test here can settle: sigouin.net is a Cloudflare Pages project (`sigouin-net`), and the relay is a
Worker. Cloudflare's routes page says a route runs "in front of your application server" and does not name Pages
(read 2026-11-12). Step 4 settles it before the game is touched.

1. In `wrangler.jsonc`, turn on the `routes` line at the bottom.
2. Log wrangler in by its browser login (`wrangler login`). Never the token in `personal/.env`.
3. `relay/node_modules/.bin/wrangler deploy --cwd relay --var ALLOWED_ORIGINS:https://sigouin.net`. The first deploy
   creates the Worker and its room class. The `--var` leaves `localhost` off the live relay's list (not tried: nothing was deployed).
4. Check: `curl https://sigouin.net/portage/relay/health` prints `portage relay: ok`. If the site's own page answers instead, the route is not in front of the Pages site: use a subdomain (below). Nothing is broken at this point: the game has not changed.
5. Build the game with the setting: in `deploy/deploy.sh`, the build line becomes `PORTAGE_RELAY=/portage/relay "$ROOT/game/node_modules/.bin/vite" build ...`.
6. Run the game's deploy as usual. Its own smoke test already runs the build under the site's security policy.
7. On the live site: Host a crew on one computer, open the link on another.

If the route cannot sit in front of the site: give the Worker a custom domain (`relay.sigouin.net`), build with
`PORTAGE_RELAY=wss://relay.sigouin.net`, add `wss://relay.sigouin.net` to `connect-src` in `sigouin-net/site/_headers`, and add the new origin nowhere else: the page's origin stays `https://sigouin.net`, which `ALLOWED_ORIGINS` already has.

To undo: `wrangler delete --cwd relay`, and build the game without the setting. The lobby goes back to five entries.

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
- Not said on either page: whether the rooms' 100,000 requests are the same 100,000 as the account's Workers. Count on the worst: an hour of four players takes 13% of what Luc's other Workers have that day.
