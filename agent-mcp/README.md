# Leash agent MCP

A bare-bones MCP server that gives ChatGPT, Claude or any MCP client an agent wallet on Sepolia.
It holds one Leash session key and signs with it. The key can only spend its on-chain allowance.
Anything more needs the owner to approve a higher limit on their Leash stick.

## Tools

| Tool | What it does |
| --- | --- |
| `get_wallet` | Allowance left, total, expiry, wallet balance, contacts |
| `send_eth` | Sends ETH to a `0x` address or a contact such as `ABC`. Over the allowance, it asks the owner for a higher limit and returns a `request_id` |
| `wait_for_approval` | Waits up to 45 s for the owner. Once the new limit confirms, it sends the waiting payment |
| `request_higher_limit` | Asks for a higher total without a payment attached |

## Run it

1. Start the Leash hub (`cd hub && npm start`) and create a session key in the Leash phone app.
2. Copy the session key on the phone, then run:

   ```sh
   SESSION_KEY=0x… ./run-local.sh
   ```

   It prints a public `https://…trycloudflare.com/mcp/<token>` URL.

3. Connect a client:
   - **ChatGPT:** Settings, Apps and Connectors, Advanced, turn on Developer mode. Then Create a connector with the URL above and "No authentication". In a chat, pick the connector from the tools menu.
   - **Claude:** Settings, Connectors, Add custom connector, paste the URL.

4. Try: "Send 0.000002 ETH to ABC, then send 0.000008 ETH to ABC."

## Deploy it somewhere

It's one Node file with a Dockerfile, so Render, Railway, Fly or any container host works. Set:

| Variable | Value |
| --- | --- |
| `SESSION_KEY` | The key copied from the phone |
| `HUB_URL` | A public URL for the hub, e.g. from `cloudflared tunnel --url http://localhost:8787` |
| `MCP_TOKEN` | A random string. The endpoint becomes `/mcp/<MCP_TOKEN>` |

The hub still runs next to the sticks, because it pays gas and routes approvals to the phone.

## On the Lightsail server

It runs as the `leash-agent-mcp` systemd service behind Caddy at `https://13-235-16-182.sslip.io`.
Settings live in `/etc/leash-agent-mcp.env`, and the endpoint is `/mcp/<MCP_TOKEN>` from that file.

- **Reach the hub:** keep `./hub-tunnel.sh` running on the Mac with the sticks. The server sees the hub at `127.0.0.1:8787`.
- **Set the session key:** `ssh -i ~/Downloads/VorfluxLaptop.pem ubuntu@13.235.16.182 leash-set-key`, then paste the key.
- **Logs:** `journalctl -u leash-agent-mcp -f`

## Security

Anyone with the URL can spend what is left of the allowance, so keep the token secret.
That is the whole exposure: the key cannot raise its own limit, outlive its expiry or touch
the rest of the wallet, and the owner can revoke it from the phone at any time.
