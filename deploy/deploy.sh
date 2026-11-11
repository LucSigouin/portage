#!/usr/bin/env bash
# Publishes the game at https://sigouin.net/portage/.
# It builds main, tests the build under sigouin.net's security policy, copies it into the sigouin.net site
# folder, runs that site's own deploy script, then checks that the live files are the built files.
#
#   TMPDIR=<writable scratch folder> bash deploy/deploy.sh --yes
#
# Needs Luc's go each time. Roll back: delete sigouin-net/site/portage and run sigouin-net/deploy/deploy.sh,
# or pick the previous deployment in the Cloudflare Pages dashboard.
set -euo pipefail

ROOT=/Users/ls/Claude-Workspace/personal/portage
SITE=/Users/ls/Claude-Workspace/personal/sigouin-net
LIVE=https://sigouin.net/portage/
WORK="${TMPDIR:?Set TMPDIR to a writable scratch folder}"

if [ "${1:-}" != "--yes" ]; then
  printf 'This publishes the game to %s. Run again with --yes.\n' "$LIVE"
  exit 1
fi

# Only a clean main goes live, and only onto a sigouin.net folder with nothing else pending.
[ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = main ] || { printf 'Not on main.\n' >&2; exit 1; }
[ -z "$(git -C "$ROOT" status --porcelain)" ] || { printf 'Portage has uncommitted changes.\n' >&2; exit 1; }
[ -z "$(git -C "$SITE" status --porcelain -- site ':!site/portage' ':!site/_headers')" ] || { printf 'sigouin-net/site has other uncommitted changes.\n' >&2; exit 1; }
grep -q '^/portage/$' "$SITE/site/_headers" || { printf 'sigouin-net/site/_headers has no /portage/ block.\n' >&2; exit 1; }

npm --prefix "$ROOT/game" run check --cache "$WORK/npmcache"

DIST="$WORK/portage-dist"
"$ROOT/game/node_modules/.bin/vite" build "$ROOT/game" --base=/portage/ --outDir "$DIST" --emptyOutDir
node "$ROOT/deploy/smoke.mjs" local "$DIST" "$SITE/site/_headers"

rsync -a --delete "$DIST/" "$SITE/site/portage/"
CONFIRM_DEPLOY=1 bash "$SITE/deploy/deploy.sh"

# The deploy is done when the live page is the built page. Pages can take a few minutes.
want="$(shasum -a 256 < "$DIST/index.html" | cut -d' ' -f1)"
for attempt in $(seq 1 30); do
  got="$(curl -s "${LIVE}?fresh=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)"
  [ "$got" = "$want" ] && break
  [ "$attempt" = 30 ] && { printf 'Live page never matched the build (want %s, got %s).\n' "$want" "$got" >&2; exit 1; }
  sleep 10
done

mismatch=0
while IFS= read -r file; do
  relative="${file#"$DIST"/}"
  [ "$relative" = index.html ] && continue
  local_hash="$(shasum -a 256 < "$file" | cut -d' ' -f1)"
  live_hash="$(curl -s "${LIVE}${relative}" | shasum -a 256 | cut -d' ' -f1)"
  if [ "$local_hash" != "$live_hash" ]; then printf 'DIFFERENT %s\n' "$relative"; mismatch=1; fi
done < <(find "$DIST" -type f)
[ "$mismatch" = 0 ] || { printf 'Some live files differ from the build.\n' >&2; exit 1; }
printf 'Live files match the build: index %s, %s files.\n' "${want:0:16}" "$(find "$DIST" -type f | wc -l | tr -d ' ')"

node "$ROOT/deploy/smoke.mjs" live "$LIVE"
