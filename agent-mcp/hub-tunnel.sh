#!/bin/sh
# Keep the Leash hub on this machine reachable from the agent MCP server, over SSH.
# The server sees the hub at 127.0.0.1:8787; nothing is exposed to the internet.
# usage: ./hub-tunnel.sh [ubuntu@13.235.16.182] [~/Downloads/VorfluxLaptop.pem]
HOST="${1:-ubuntu@13.235.16.182}"
KEY="${2:-$HOME/Downloads/VorfluxLaptop.pem}"
while true; do
  ssh -i "$KEY" -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
    -R 127.0.0.1:8787:127.0.0.1:8787 "$HOST"
  echo "$(date +%T) hub tunnel dropped, reconnecting" >&2
  sleep 3
done
