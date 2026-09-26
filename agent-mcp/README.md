# Kagi agent MCP

A bare-bones MCP server that gives an MCP client an agent wallet on-chain.
It holds one Kagi session key and talks to the chain directly: it signs spends, sends them, and
pays its gas from the key's own address (the phone tops it up at grant). The key can only spend
its on-chain allowance. For more, it files a limit request on-chain; the owner's phone sees it,
and the owner approves on their Kagi stick or declines.

Integrated with <a href="https://intercepta.io"><picture><source media="(prefers-color-scheme: dark)" srcset="../site/public/partners/intercepta-light.png" /><img src="../site/public/partners/intercepta-dark.png" alt="Intercepta" height="24" /></picture></a> &nbsp; <a href="https://www.curvegrid.com/multibaas"><picture><source media="(prefers-color-scheme: dark)" srcset="../site/public/partners/curvegrid-light.png" /><img src="../site/public/partners/curvegrid-dark.png" alt="Curvegrid MultiBaas" height="24" /></picture></a>: Intercepta screens every recipient before the key signs, and Curvegrid MultiBaas indexes the wallet's history for `get_activity`.

## Tools

| Tool | What it does |
| --- | --- |
| `get_wallet` | Allowance left, total, expiry, wallet balance, contacts |
| `send_eth` | Sends ETH to a `0x` address, or to a saved contact if `CONTACTS` is set. With Intercepta on, it screens the recipient first: refused recipients never get a signature, and flagged ones are held for the owner. Over the allowance, it asks the owner for a higher limit and returns a `request_id` |
| `wait_for_approval` | Waits up to 45 s for the owner. Once the new limit confirms, it sends the waiting payment |
| `get_activity` | With MultiBaas set up: the wallet's history, meaning payments, limit requests and the owner's approvals, declines and revokes, from the Curvegrid MultiBaas event index |
| `request_higher_limit` | Asks for a higher total without a payment attached |
| `use_my_key` | On the `/demo` link only: switches this connection to the user's own key, `kagi:0x…:0x…`. It lasts for the connection |

## Use the shared server

One server serves everyone at `https://13-235-16-182.sslip.io`. Each person's connector link carries
their own key: `https://13-235-16-182.sslip.io/k/<account><key>`.

1. In the Kagi phone app, create an agent key and tap **Copy connector link**.
2. Add the link as an MCP server. The website's Connect your AI section has a button for each app:
   - **ChatGPT:** add a custom connector with the link and no authentication
   - **Claude** (web, desktop and mobile): open [claude.ai/new#customize/connectors](https://claude.ai/new#customize/connectors), choose Add custom connector, name it `kagi` and paste the link
   - **Claude Code** (terminal, or its VS Code and JetBrains extensions): `claude mcp add --transport http kagi <link>`
   - **Codex:** `codex mcp add kagi --url <link>`
   - **Cursor, VS Code:** one-click install links built from the link
3. Try: "Send 0.000002 ETH to 0x7aa25897BB2457F46109EF1886b3F0EBB6E5f67E, then send 0.000008 ETH to the same address."

The server only holds a key for the length of each request and never logs paths.

**Without a link:** add `https://13-235-16-182.sslip.io/demo`, then give the AI your session key (Copy session key only in the app). It calls `use_my_key` and spends from your wallet for that connection. The key then sits in your chat history, so the connector link is the better habit.

`npm test` runs the whole loop on a local anvil chain: spend, ask for more, approve, decline.

## Deploy it somewhere

It's one Node file with a Dockerfile, so Render, Railway, Fly or any container host works. Set:

| Variable | Value |
| --- | --- |
| `SESSION_KEY` | Optional. A single key served at `/mcp/<MCP_TOKEN>`, as `kagi:<account>:<key>` |
| `MCP_TOKEN` | With `SESSION_KEY`: a random string for that endpoint |
| `RPC_URL` | Optional. Defaults to a public RPC |
| `INTERCEPTA_API_KEY` | Optional. Screens every recipient before the key signs: pass, hold for the owner, or refuse |
| `RISK_HOLD` | Optional. Quick-scan risk score at which a payment is held, default `30` |
| `MULTIBAAS_URL` | Optional. `https://<deployment>.multibaas.com`, which turns on `get_activity` |
| `MULTIBAAS_API_KEY` | With `MULTIBAAS_URL`: an API key in the deployment's Administrators group |
| `MULTIBAAS_START` | Optional. How far back to index a newly linked wallet, default `-100` blocks, the free plan's maximum |
| `CONTACTS` | Optional JSON of names to addresses. Defaults to `contacts.json` |

Nothing else needs to run: no hub, no laptop.

## On the Lightsail server

It runs as the `kagi-agent-mcp` systemd service behind Caddy at `https://13-235-16-182.sslip.io`.
Settings live in `/etc/kagi-agent-mcp.env`, and the endpoint is `/mcp/<MCP_TOKEN>` from that file.

- **Set the session key:** `ssh -i ~/Downloads/VorfluxLaptop.pem ubuntu@13.235.16.182 kagi-set-key`, then paste what the phone copied.
- **Logs:** `journalctl -u kagi-agent-mcp -f`

## Security

Anyone with the URL can spend what is left of the allowance, so keep the token secret.
That is the whole exposure: the key cannot raise its own limit, outlive its expiry or touch
the rest of the wallet, and the owner can revoke it from the phone at any time.
