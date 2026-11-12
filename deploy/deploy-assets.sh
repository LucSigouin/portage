#!/usr/bin/env bash
# Publishes the asset viewer at https://sigouin.net/portage-assets/.
# The game at /portage/ is NOT built and NOT changed by this: only the folder site/portage-assets/ is replaced.
# It builds the viewer from main, tests the build under sigouin.net's security policy, copies it into the
# sigouin.net site folder, runs that site's own deploy script, then checks the live files are the built files
# and that the live game page is the same as before.
#
#   bash deploy/deploy-assets.sh --yes
#
# Needs Luc's go each time, and wrangler's browser login to Cloudflare (see deploy/login.sh).
# Take it down: delete sigouin-net/site/portage-assets and the /portage-assets/ blocks in site/_headers,
# then run sigouin-net/deploy/deploy.sh. Or pick the previous deployment in the Cloudflare Pages dashboard.
set -euo pipefail

ROOT=/Users/ls/Claude-Workspace/personal/portage
SITE=/Users/ls/Claude-Workspace/personal/sigouin-net
LIVE=https://sigouin.net/portage-assets/
GAME_LIVE=https://sigouin.net/portage/
WORK="${TMPDIR:-/private/tmp/claude-501}/portage-assets-deploy"
LOG="$WORK/deploy.log"

if [ "${1:-}" != "--yes" ]; then
  printf 'This publishes the asset viewer to %s. Run again with --yes.\n' "$LIVE"
  exit 1
fi
mkdir -p "$WORK"
: > "$LOG"
fail() { printf 'STOPPED: %s\nLast lines of %s:\n' "$1" "$LOG" >&2; tail -n 15 "$LOG" >&2; exit 1; }

[ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = main ] || fail 'Portage is not on main.'
[ -z "$(git -C "$ROOT" status --porcelain)" ] || fail 'Portage has uncommitted changes.'
[ -z "$(git -C "$SITE" status --porcelain -- site ':!site/portage-assets' ':!site/_headers')" ] || fail 'sigouin-net/site has other uncommitted changes.'
grep -q '^/portage-assets/$' "$SITE/site/_headers" || fail 'sigouin-net/site/_headers has no /portage-assets/ block.'

"$ROOT/game/node_modules/.bin/vitest" run --root "$ROOT/game" tests/viewer --maxWorkers=2 >> "$LOG" 2>&1 || fail "The viewer's tests failed."
printf "1/5 the viewer's tests pass (%s)\n" "$(grep -E '^ +Tests ' "$LOG" | tail -n 1 | sed 's/^ *//')"

DIST="$WORK/dist"
node "$ROOT/deploy/build-assets.mjs" "$DIST" >> "$LOG" 2>&1 || fail 'The build failed.'
printf '2/5 built the viewer from commit %s (%s files)\n' "$(git -C "$ROOT" rev-parse --short HEAD)" "$(find "$DIST" -type f | wc -l | tr -d ' ')"

node "$ROOT/deploy/smoke-assets.mjs" local "$DIST" "$SITE/site/_headers" >> "$LOG" 2>&1 || fail "The viewer does not run under sigouin.net's security policy."
printf "3/5 the build runs under sigouin.net's security policy (%s)\n" "$(grep -E '^local assets:' "$LOG" | tail -n 1)"

game_before="$(curl -s "${GAME_LIVE}?fresh=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)"
rsync -a --delete "$DIST/" "$SITE/site/portage-assets/"
CONFIRM_DEPLOY=1 bash "$SITE/deploy/deploy.sh" >> "$LOG" 2>&1 || fail 'The upload to Cloudflare failed.'
printf '4/5 uploaded (%s)\n' "$(grep -E '^Deployment URL:' "$LOG" | tail -n 1)"

# The deploy is done when the live page is the built page. Pages can take a few minutes.
want="$(shasum -a 256 < "$DIST/index.html" | cut -d' ' -f1)"
got=''
for attempt in $(seq 1 30); do
  got="$(curl -sL "${LIVE}?fresh=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)"
  [ "$got" = "$want" ] && break
  sleep 10
done
[ "$got" = "$want" ] || fail "The live page never matched the build (want ${want:0:16}, got ${got:0:16})."

while IFS= read -r file; do
  relative="${file#"$DIST"/}"
  [ "$relative" = index.html ] && continue
  local_hash="$(shasum -a 256 < "$file" | cut -d' ' -f1)"
  live_hash="$(curl -sL "${LIVE}${relative}" | shasum -a 256 | cut -d' ' -f1)"
  [ "$local_hash" = "$live_hash" ] || fail "Live file differs from the build: $relative"
done < <(find "$DIST" -type f)
game_after="$(curl -s "${GAME_LIVE}?fresh=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)"
[ "$game_before" = "$game_after" ] || fail "The live game page changed (${game_before:0:16} to ${game_after:0:16}). It must not."
printf '5/5 live files match the build: page %s, %s files. The live game page is unchanged (%s).\n' "${want:0:16}" "$(find "$DIST" -type f | wc -l | tr -d ' ')" "${game_after:0:16}"

node "$ROOT/deploy/smoke-assets.mjs" live "$LIVE" >> "$LOG" 2>&1 || fail 'The live viewer failed its smoke test.'
printf '     and the live viewer draws (%s)\n' "$(grep -E '^live assets:' "$LOG" | tail -n 1)"
printf 'LIVE: %s\n' "$LIVE"
