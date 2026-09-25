#!/usr/bin/env bash
# Run Leash so the phone and the wrist can each be on any network with internet.
#
#   hub      on this laptop, reachable through a Cloudflare quick tunnel
#   metro    serves the app to Expo Go through a second tunnel
#   wrist    learns the relay address from the hub (plug it in once after the tunnel
#            address changes, or have it on the same network as the laptop)
#   phone    opens the app at the printed exp:// address
#
# Quick tunnel addresses change every time this starts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="${TMPDIR:-/tmp}/leash"
mkdir -p "$LOGS"

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

rm -f "$ROOT/hub/.public.json"
(cd "$ROOT/hub" && node index.mjs --tunnel) > "$LOGS/hub.log" 2>&1 &
echo "starting hub and tunnels (log: $LOGS/hub.log)"
for _ in $(seq 1 60); do [ -f "$ROOT/hub/.public.json" ] && break; sleep 1; done
[ -f "$ROOT/hub/.public.json" ] || { echo "tunnels did not come up"; tail -20 "$LOGS/hub.log"; exit 1; }

read -r PHONE_URL METRO_URL < <(python3 -c "import json,sys;p=json.load(open(sys.argv[1]));print(p['phoneUrl'],p['metro'])" "$ROOT/hub/.public.json")
METRO_HOST="${METRO_URL#https://}"

(cd "$ROOT/mobile" && EXPO_PUBLIC_HUB_URL="$PHONE_URL" EXPO_PACKAGER_PROXY_URL="$METRO_URL" \
  npx expo start --port 8081 --clear < /dev/null) > "$LOGS/metro.log" 2>&1 &
echo "starting metro (log: $LOGS/metro.log)"
for _ in $(seq 1 60); do curl -sf -m 3 "$METRO_URL/status" >/dev/null && break; sleep 1; done

echo
echo "Open in Expo Go:  exp://$METRO_HOST"
if command -v adb >/dev/null && adb get-state >/dev/null 2>&1; then
  adb shell am start -a android.intent.action.VIEW -d "exp://$METRO_HOST" host.exp.exponent >/dev/null && echo "(opened on the USB phone)"
fi
echo "Ctrl+C stops everything."
tail -f "$LOGS/hub.log"
