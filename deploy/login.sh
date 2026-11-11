#!/usr/bin/env bash
# Signs wrangler in to Cloudflare. Run it when a deploy says the login has expired.
# It opens a browser tab; approve there and it finishes by itself.
set -euo pipefail
CACHE="${NPM_CACHE:-${TMPDIR:-/private/tmp/claude-501}/npmcache}"
exec npx --yes --cache "$CACHE" wrangler@4.133.0 login
