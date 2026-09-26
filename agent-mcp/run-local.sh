#!/bin/sh
# Run the agent MCP on this machine behind a public HTTPS tunnel, and print the URL for ChatGPT.
# usage: SESSION_KEY=0x… ./run-local.sh      (the Leash hub must be running on :8787)
set -e
cd "$(dirname "$0")"
[ -n "$SESSION_KEY" ] || { echo "Set SESSION_KEY to the key copied from the Leash phone app."; exit 1; }
[ -d node_modules ] || npm install --silent
export MCP_TOKEN="${MCP_TOKEN:-$(openssl rand -hex 12)}" PORT="${PORT:-8790}"
LOG=$(mktemp)
node server.mjs &
SERVER=$!
cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate >"$LOG" 2>&1 &
TUNNEL=$!
trap 'kill $SERVER $TUNNEL 2>/dev/null' INT TERM EXIT
until URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG" | head -1) && [ -n "$URL" ]; do sleep 1; done
echo
echo "MCP server URL (paste into ChatGPT or Claude):"
echo "  $URL/mcp/$MCP_TOKEN"
echo
wait $SERVER
