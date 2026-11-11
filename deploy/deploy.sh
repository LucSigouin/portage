#!/usr/bin/env bash
# Publishes the game at https://sigouin.net/portage/.
# It builds main, tests the build under sigouin.net's security policy, copies it into the sigouin.net site
# folder, runs that site's own deploy script, then checks that the live files are the built files.
#
#   bash deploy/deploy.sh --yes
#
# Needs Luc's go each time, and a shell that is signed in to Cloudflare (Luc's own shell has the token;
# if a deploy says the login expired, run deploy/login.sh). Roll back: delete sigouin-net/site/portage
# and run sigouin-net/deploy/deploy.sh, or pick the previous deployment in the Cloudflare Pages dashboard.
set -euo pipefail

ROOT=/Users/ls/Claude-Workspace/personal/portage
SITE=/Users/ls/Claude-Workspace/personal/sigouin-net
LIVE=https://sigouin.net/portage/
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

npm --prefix "$ROOT/game" run check --cache "$WORK/npmcache" >> "$LOG" 2>&1 || fail 'The tests failed.'
printf '1/6 tests pass (%s)\n' "$(grep -E '^ +Tests ' "$LOG" | tail -n 1 | sed 's/^ *//')"

DIST="$WORK/dist"
"$ROOT/game/node_modules/.bin/vite" build "$ROOT/game" --base=/portage/ --outDir "$DIST" --emptyOutDir >> "$LOG" 2>&1 || fail 'The build failed.'
printf '2/6 built commit %s\n' "$(git -C "$ROOT" rev-parse --short HEAD)"

node "$ROOT/deploy/smoke.mjs" local "$DIST" "$SITE/site/_headers" >> "$LOG" 2>&1 || fail "The build does not run under sigouin.net's security policy."
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
  live_hash="$(curl -s "${LIVE}${relative}" | shasum -a 256 | cut -d' ' -f1)"
  [ "$local_hash" = "$live_hash" ] || fail "Live file differs from the build: $relative"
done < <(find "$DIST" -type f)
printf '5/6 live files match the build: page %s, %s files\n' "${want:0:16}" "$(find "$DIST" -type f | wc -l | tr -d ' ')"

node "$ROOT/deploy/smoke.mjs" live "$LIVE" >> "$LOG" 2>&1 || fail 'The live game failed its smoke test.'
printf '6/6 the live game starts, takes a click and a key press (%s)\n' "$(grep -E '^live:' "$LOG" | tail -n 1)"
printf 'LIVE: %s\n' "$LIVE"
