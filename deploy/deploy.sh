#!/usr/bin/env bash
# Publishes the game at https://sigouin.net/portage/, and the workbench page at https://sigouin.net/portage/workbench.
# It builds main, tests the build under sigouin.net's security policy, copies it into the sigouin.net site
# folder, runs that site's own deploy script, then checks that the live files are the built files.
#
# The game is built with the relay turned on (PORTAGE_RELAY below): the lobby has "Host a crew" and "Join a crew",
# and friends join by a link. The relay is its own deploy (deploy/deploy-relay.sh) and must already answer.
# To publish a game with no crew entries: take PORTAGE_RELAY and the three relay checks out of this script.
#
#   bash deploy/deploy.sh --yes
#
# Needs Luc's go each time, and wrangler's browser login to Cloudflare. If the upload says a token is
# needed, the login has expired: run deploy/login.sh, approve in the browser, then run this again. Roll back: delete sigouin-net/site/portage
# and run sigouin-net/deploy/deploy.sh, or pick the previous deployment in the Cloudflare Pages dashboard.
set -euo pipefail

ROOT=/Users/ls/Claude-Workspace/personal/portage
SITE=/Users/ls/Claude-Workspace/personal/sigouin-net
LIVE=https://sigouin.net/portage/
# Where the game finds the relay: a path on the site's own host, so the site's security policy stays as it is.
RELAY_PATH=/portage/relay
WORK="${TMPDIR:-/private/tmp/claude-501}/portage-deploy"
LOG="$WORK/deploy.log"

if [ "${1:-}" != "--yes" ]; then
  printf 'This publishes the game to %s. Run again with --yes.\n' "$LIVE"
  exit 1
fi
mkdir -p "$WORK"
: > "$LOG"
fail() { printf 'STOPPED: %s\nLast lines of %s:\n' "$1" "$LOG" >&2; tail -n 15 "$LOG" >&2; exit 1; }

# Only a clean main goes live, and only onto a sigouin.net folder with nothing else pending.
[ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = main ] || fail 'Portage is not on main.'
[ -z "$(git -C "$ROOT" status --porcelain)" ] || fail 'Portage has uncommitted changes.'
[ -z "$(git -C "$SITE" status --porcelain -- site ':!site/portage' ':!site/_headers')" ] || fail 'sigouin-net/site has other uncommitted changes.'
grep -q '^/portage/$' "$SITE/site/_headers" || fail 'sigouin-net/site/_headers has no /portage/ block.'
grep -q '^/portage/workbench$' "$SITE/site/_headers" || fail 'sigouin-net/site/_headers has no /portage/workbench block.'

[ "$(curl -s -m 10 "https://sigouin.net${RELAY_PATH}/health?fresh=$(date +%s)")" = 'portage relay: ok' ] \
  || fail 'The relay does not answer on the site. Run deploy/deploy-relay.sh first.'

npm --prefix "$ROOT/game" run check --cache "$WORK/npmcache" >> "$LOG" 2>&1 || fail 'The tests failed.'
printf '1/6 tests pass (%s)\n' "$(grep -E '^ +Tests ' "$LOG" | tail -n 1 | sed 's/^ *//')"

DIST="$WORK/dist"
PORTAGE_RELAY="$RELAY_PATH" "$ROOT/game/node_modules/.bin/vite" build "$ROOT/game" --base=/portage/ --outDir "$DIST" --emptyOutDir >> "$LOG" 2>&1 || fail 'The build failed.'
grep -q "$RELAY_PATH" "$DIST"/assets/*.js && grep -q 'new WebSocket' "$DIST"/assets/*.js || fail 'The build has no relay in it: no "Host a crew" would show.'
# The public copy of the workbench page goes into the same folder, so it is tested, uploaded and hash-checked with the game.
node "$ROOT/hub/workbench.mjs" --out "$DIST" --public >> "$LOG" 2>&1 || fail 'The workbench page did not build.'
printf '2/6 built commit %s, and the workbench page (%s)\n' "$(git -C "$ROOT" rev-parse --short HEAD)" "$(grep -E 'workbench\.html [0-9]+ steps' "$LOG" | tail -n 1 | sed -E 's/^.*workbench\.html (.*): .*$/\1/')"

node "$ROOT/deploy/smoke.mjs" local "$DIST" "$SITE/site/_headers" >> "$LOG" 2>&1 || fail "The build does not run under sigouin.net's security policy."
node "$ROOT/deploy/smoke-workbench.mjs" local "$DIST" "$SITE/site/_headers" >> "$LOG" 2>&1 || fail "The workbench page fails under sigouin.net's security policy."
printf "3/6 the build runs under sigouin.net's security policy\n"

rsync -a --delete "$DIST/" "$SITE/site/portage/"
CONFIRM_DEPLOY=1 bash "$SITE/deploy/deploy.sh" >> "$LOG" 2>&1 || fail 'The upload to Cloudflare failed.'
printf '4/6 uploaded (%s)\n' "$(grep -E '^Deployment URL:' "$LOG" | tail -n 1)"

# The deploy is done when the live page is the built page. Pages can take a few minutes.
want="$(shasum -a 256 < "$DIST/index.html" | cut -d' ' -f1)"
got=''
for attempt in $(seq 1 30); do
  got="$(curl -s "${LIVE}?fresh=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)"
  [ "$got" = "$want" ] && break
  sleep 10
done
[ "$got" = "$want" ] || fail "The live page never matched the build (want ${want:0:16}, got ${got:0:16})."

while IFS= read -r file; do
  relative="${file#"$DIST"/}"
  [ "$relative" = index.html ] && continue
  local_hash="$(shasum -a 256 < "$file" | cut -d' ' -f1)"
  # -L: Cloudflare Pages answers workbench.html with a redirect to /portage/workbench.
  live_hash="$(curl -sL "${LIVE}${relative}" | shasum -a 256 | cut -d' ' -f1)"
  [ "$local_hash" = "$live_hash" ] || fail "Live file differs from the build: $relative"
done < <(find "$DIST" -type f)
printf '5/6 live files match the build: page %s, %s files\n' "${want:0:16}" "$(find "$DIST" -type f | wc -l | tr -d ' ')"

node "$ROOT/deploy/smoke.mjs" live "$LIVE" >> "$LOG" 2>&1 || fail 'The live game failed its smoke test.'
printf '6/6 the live game starts, takes a click and a key press (%s)\n' "$(grep -E '^live:' "$LOG" | tail -n 1)"
node "$ROOT/deploy/smoke-workbench.mjs" live "$LIVE" >> "$LOG" 2>&1 || fail 'The live workbench page failed its smoke test.'
printf '     and the live workbench page reads on a phone-sized screen (%s)\n' "$(grep -E '^live workbench:' "$LOG" | tail -n 1)"
node "$ROOT/deploy/smoke-crew.mjs" "$LIVE" >> "$LOG" 2>&1 || fail 'Two browsers could not share a canoe on the live game.'
printf '     and two browsers share a canoe by an invite link (%s)\n' "$(grep -E '^crew:' "$LOG" | tail -n 1)"
printf 'LIVE: %s and %sworkbench\n' "$LIVE" "$LIVE"
