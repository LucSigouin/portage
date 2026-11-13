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
# Undo: from an empty folder, `<portage>/relay/node_modules/.bin/wrangler delete --name portage-relay`.
# Then take PORTAGE_RELAY out of deploy/deploy.sh and deploy the game: the lobby goes back to five entries.
set -euo pipefail

ROOT=/Users/ls/Claude-Workspace/personal/portage
ENV_FILE=/Users/ls/Claude-Workspace/personal/.env
ROUTE='sigouin.net/portage/relay/*'
RELAY=wss://sigouin.net/portage/relay
ORIGIN=https://sigouin.net
GAME_LIVE=https://sigouin.net/portage/
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
(cd "$STAGE" && "$WRANGLER" deploy --route "$ROUTE" --var "ALLOWED_ORIGINS:$ORIGIN") >> "$LOG" 2>&1 \
  || fail 'The upload to Cloudflare failed. If it asks for a token, the browser login has expired: run deploy/login.sh.'
printf '2/4 uploaded commit %s (%s)\n' "$(git -C "$ROOT" rev-parse --short HEAD)" "$(grep -E 'Current Version ID' "$LOG" | tail -n 1 | sed 's/^ *//')"

# The route sits in front of the site. Until it answers, the site's own "not found" page does.
got=''
for attempt in $(seq 1 24); do
  got="$(curl -s -m 10 "https://sigouin.net/portage/relay/health?fresh=$(date +%s)" || true)"
  [ "$got" = 'portage relay: ok' ] && break
  sleep 5
done
[ "$got" = 'portage relay: ok' ] || fail "https://sigouin.net/portage/relay/health does not answer as the relay. It said: $(printf '%s' "$got" | head -c 80)"
printf '3/4 the relay answers on the site (%s)\n' "$got"

node "$ROOT/deploy/smoke-relay.mjs" "$RELAY" "$ORIGIN" >> "$LOG" 2>&1 || fail 'The live relay failed its smoke test.'
game_after="$(curl -s "${GAME_LIVE}?fresh=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)"
[ "$game_before" = "$game_after" ] || fail "The live game page changed (${game_before:0:16} to ${game_after:0:16}). It must not."
printf '4/4 a host and a guest meet through it (%s). The live game page is unchanged (%s).\n' "$(grep -E '^relay:' "$LOG" | tail -n 1)" "${game_after:0:16}"
printf 'LIVE: %s\n' "$RELAY"
