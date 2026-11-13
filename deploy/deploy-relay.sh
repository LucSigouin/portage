#!/usr/bin/env bash
# Publishes the relay (relay/) to Cloudflare as the Worker `portage-relay`, answering on
# sigouin.net/portage/relay/*. The relay is what lets friends on other computers share a canoe.
# It does not touch the game or the site, and checks that the live game page is the same afterwards.
#
#   bash deploy/deploy-relay.sh --yes
#
# Needs Luc's go each time, the relay's tools (`npm --prefix relay ci`), and wrangler's browser login to
# Cloudflare (deploy/login.sh). Never an API token: wrangler runs from an empty folder with no token in sight.
# The game only uses the relay when it is built with PORTAGE_RELAY=/portage/relay (deploy/deploy.sh does).
#
# Every upload is given a name, the commit and the time (BUILD below), which the relay prints as the second
# line of /health. The script waits for that name, so its checks run against the relay it just uploaded and
# never against the one that was there before. The last check dials in a loop until the relay's dial limit
# stops it (at most 150 dials), then waits up to 90 s for the limit to let this address in again.
#
# Feedback (relay/src/feedback.ts): play testers' notes are kept in the D1 database `portage-feedback` on
# Luc's account. This script looks the database up by its name and gives its id to the upload. When the account
# has no such database the relay is uploaded without a store, and answers every note with "feedback is off".
# FEEDBACK=off below does the same and keeps what is stored. Read the notes: deploy/read-feedback.sh.
#
# Undo: from an empty folder, `<portage>/relay/node_modules/.bin/wrangler delete --name portage-relay`.
# Then take PORTAGE_RELAY out of deploy/deploy.sh and deploy the game: the lobby goes back to five entries.
set -euo pipefail

ROOT=/Users/ls/Claude-Workspace/personal/portage
ENV_FILE=/Users/ls/Claude-Workspace/personal/.env
ROUTE='sigouin.net/portage/relay/*'
RELAY=wss://sigouin.net/portage/relay
HEALTH=https://sigouin.net/portage/relay/health
ORIGIN=https://sigouin.net
GAME_LIVE=https://sigouin.net/portage/
# `on`: the relay keeps play testers' notes. `off`: it refuses every note, and what is stored stays.
FEEDBACK=on
FEEDBACK_STORE=portage-feedback
WRANGLER="$ROOT/relay/node_modules/.bin/wrangler"
WORK="${TMPDIR:-/private/tmp/claude-501}/portage-deploy"
LOG="$WORK/deploy-relay.log"

if [ "${1:-}" != "--yes" ]; then
  printf 'This publishes the relay on %s. Run again with --yes.\n' "$ROUTE"
  exit 1
fi
mkdir -p "$WORK"
: > "$LOG"
fail() { printf 'STOPPED: %s\nLast lines of %s:\n' "$1" "$LOG" >&2; tail -n 15 "$LOG" >&2; exit 1; }

# Only a clean, tested main goes live.
[ "$(git -C "$ROOT" rev-parse --abbrev-ref HEAD)" = main ] || fail 'Portage is not on main.'
[ -z "$(git -C "$ROOT" status --porcelain)" ] || fail 'Portage has uncommitted changes.'
[ -x "$WRANGLER" ] || fail 'The relay has no tools yet. Run: npm --prefix relay ci'
[ ! -e "$ROOT/relay/.env" ] && [ ! -e "$ROOT/relay/.dev.vars" ] || fail 'relay/ holds a .env or .dev.vars file. It must not.'

npm --prefix "$ROOT/relay" run check --cache "$WORK/npmcache" >> "$LOG" 2>&1 || fail "The relay's tests failed."
printf "1/4 the relay's tests pass (%s)\n" "$(grep -E '^. (pass|fail) ' "$LOG" | tr '\n' ' ' | sed 's/ $//')"

game_before="$(curl -s "${GAME_LIVE}?fresh=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)"

# Wrangler reads a .env file in the folder it runs from, and personal/.env holds an API token. So it runs
# from a clean copy in an empty folder, signed in by the browser login only.
STAGE="$(mktemp -d)"
trap 'rm -r "$STAGE"' EXIT
rsync -a --exclude node_modules --exclude '.*' --exclude tests "$ROOT/relay/" "$STAGE/"
unset CLOUDFLARE_API_TOKEN CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL
# Only the account id is read from the shared .env, as sigouin-net/deploy/deploy.sh does. It is not a secret.
CLOUDFLARE_ACCOUNT_ID="$(grep -E '^CLOUDFLARE_ACCOUNT_ID=' "$ENV_FILE" | cut -d= -f2- | tr -d "\"'")"
export CLOUDFLARE_ACCOUNT_ID
export WRANGLER_SEND_METRICS=false
# The route and the live list of allowed pages are given here, not in wrangler.jsonc: the file stays the
# one for this computer (no route, localhost allowed), and the live relay answers the site alone.
# This upload's name: the commit, and the time, so that a second upload of the same commit is told apart too.
BUILD="$(git -C "$ROOT" rev-parse --short HEAD)-$(date -u +%Y%m%dT%H%M%SZ)"

# The feedback store. Its id is not in wrangler.jsonc either: the file holds a stand-in for this computer.
# FEEDBACK_DATABASE_ID=<id> in front of this script gives the id by hand and skips the look-up.
store_id="${FEEDBACK_DATABASE_ID:-}"
if [ -z "$store_id" ]; then
  (cd "$STAGE" && "$WRANGLER" d1 list --json) > "$WORK/d1-list.json" 2>> "$LOG" \
    || fail "Could not list the account's databases. If it asks for a token, the browser login has expired: run deploy/login.sh."
  look=0
  store_id="$(node "$ROOT/deploy/feedback-store.mjs" id "$FEEDBACK_STORE" < "$WORK/d1-list.json" 2>> "$LOG")" || look=$?
  # 3: the account has no such database, which is a fair state. Anything else is a list that could not be read.
  [ "$look" = 0 ] || [ "$look" = 3 ] || fail "The list of databases could not be read. To go on without it: FEEDBACK_DATABASE_ID=<id> bash deploy/deploy-relay.sh --yes"
fi
if [ -n "$store_id" ]; then
  node "$ROOT/deploy/feedback-store.mjs" bind "$STAGE/wrangler.jsonc" "$store_id" >> "$LOG" 2>&1 || fail 'The feedback store could not be put into the upload.'
  feedback_check="$FEEDBACK"
  feedback_words="feedback store $FEEDBACK_STORE ${store_id:0:8}, feedback $FEEDBACK"
else
  node "$ROOT/deploy/feedback-store.mjs" cut "$STAGE/wrangler.jsonc" >> "$LOG" 2>&1 || fail 'The feedback store could not be taken out of the upload.'
  feedback_check=off
  feedback_words="no database called $FEEDBACK_STORE on the account, so feedback is off (relay/README.md says how to make it)"
fi

(cd "$STAGE" && "$WRANGLER" deploy --route "$ROUTE" --var "ALLOWED_ORIGINS:$ORIGIN" --var "BUILD:$BUILD" --var "FEEDBACK:$FEEDBACK") >> "$LOG" 2>&1 \
  || fail "The upload to Cloudflare failed. If it asks for a token, the browser login has expired: run deploy/login.sh. To see which relay answers now: curl $HEALTH"
printf '2/4 uploaded build %s (%s; %s)\n' "$BUILD" "$(grep -E 'Current Version ID' "$LOG" | tail -n 1 | sed 's/^ *//')" "$feedback_words"

# The route sits in front of the site. Until it answers, the site's own "not found" page does. And on every
# deploy but the first, the relay from before answers "ok" as well: only the build's name tells the two apart.
node "$ROOT/deploy/wait-relay.mjs" "$HEALTH" "$BUILD" 120 >> "$LOG" 2>&1 \
  || fail "$HEALTH never answered as build $BUILD. The upload went through, so look at what it says now: curl $HEALTH"
printf '3/4 the new relay answers on the site (%s)\n' "$(grep -E '^relay build:' "$LOG" | tail -n 1)"

node "$ROOT/deploy/smoke-relay.mjs" "$RELAY" "$ORIGIN" --build "$BUILD" --limit --feedback "$feedback_check" >> "$LOG" 2>&1 \
  || fail 'The live relay failed its smoke test. It is live all the same: the upload was not undone.'
game_after="$(curl -s "${GAME_LIVE}?fresh=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)"
[ "$game_before" = "$game_after" ] || fail "The live game page changed (${game_before:0:16} to ${game_after:0:16}). It must not."
printf '4/4 a host and a guest meet through it, and a script that dials in a loop is stopped (%s). The live game page is unchanged (%s).\n' "$(grep -E '^relay:' "$LOG" | tail -n 1)" "${game_after:0:16}"
printf 'LIVE: %s\n' "$RELAY"
