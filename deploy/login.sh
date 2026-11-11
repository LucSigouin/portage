#!/usr/bin/env bash
# Signs wrangler in to Cloudflare through the browser. Run it when a deploy says the login has expired.
# It opens a browser tab; approve there and it finishes by itself.
set -euo pipefail
CACHE="${NPM_CACHE:-${TMPDIR:-/private/tmp/claude-501}/npmcache}"
mkdir -p "$CACHE"
# Wrangler reads a .env file in the folder it runs from. personal/.env holds an API token, and with a token
# in sight wrangler refuses the browser login. So run it from an empty folder.
cd "$(mktemp -d)"
exec npx --yes --cache "$CACHE" wrangler@4.133.0 login
