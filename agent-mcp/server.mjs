// Leash agent MCP: an agent's wallet, as tools for ChatGPT, Claude or any MCP client.
//
// This server holds ONE Leash session key (SESSION_KEY) and signs with it. Everything else goes
// through the Leash hub (HUB_URL): the hub finds the wallet, pays gas, and routes limit requests
// to the owner's phone and stick. The session key can only spend its on-chain allowance, and a
// higher allowance needs a hold on the owner's stick.
//
//   SESSION_KEY  0x… private key copied from the Leash phone app            (required)
//   HUB_URL      where the Leash hub is reachable, e.g. https://….trycloudflare.com
//                                                   (default http://localhost:8787)
//   MCP_TOKEN    secret path segment: the endpoint becomes /mcp/<MCP_TOKEN>  (recommended)
//   PORT         default 8790
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { formatEther, parseEther } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { z } from 'zod';

const RAW_KEY = process.env.SESSION_KEY?.trim() ?? '';
// Without a key the server still runs, and every tool says how to add one.
const KEY = /^0x[0-9a-fA-F]{64}$/.test(RAW_KEY) ? RAW_KEY : null;
if (!KEY) console.error('No valid SESSION_KEY set. Tools will ask for one until it is.');
const HUB = (process.env.HUB_URL ?? 'http://localhost:8787').replace(/\/+$/, '');
const TOKEN = process.env.MCP_TOKEN?.trim() || null;
const PORT = Number(process.env.PORT ?? 8790);
const AGENT = KEY ? privateKeyToAccount(KEY).address : null;
const PATH = TOKEN ? `/mcp/${TOKEN}` : '/mcp';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const eth = (wei) => `${formatEther(BigInt(wei))} ETH`;

// ---- the hub, over its own MCP (stateless JSON-RPC) -------------------------------------

let rpcId = 0;
async function hub(name, args) {
  const res = await fetch(`${HUB}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(170_000),
  });
  if (!res.ok) throw new Error(`The Leash hub answered ${res.status}.`);
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result.structuredContent ?? JSON.parse(j.result.content[0].text);
}

// Transfers waiting on a limit request, so approval can resume them. In memory: one instance.
const paused = new Map(); // requestId -> { to, amount_eth }

const reply = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data });
const NO_KEY = {
  ok: false,
  status: 'not_configured',
  error: 'This server has no Leash session key yet. The owner copies one from the Leash phone app and sets SESSION_KEY on the server.',
};
// Every tool goes through this, so a server without a key fails the same clear way.
const guarded = (fn) => async (args) => (KEY ? fn(args) : reply(NO_KEY));

async function wallet() {
  const s = await hub('leash_session', { agent: AGENT });
  if (!s.found) return { ok: false, error: 'This session key is not registered with the Leash hub. Create it from the Leash phone app first.' };
  return {
    ok: true,
    agent_name: s.name,
    session_key_address: AGENT,
    wallet: s.account,
    network: s.network,
    status: s.status,
    allowance_left: s.remainingEth,
    allowance_total: s.capEth,
    spent: eth(s.spent),
    expires_in_minutes: Math.max(0, Math.round((s.expiry - s.now) / 60)),
    wallet_balance: eth(s.accountBalance),
    contacts: s.contacts,
    explorer: `${s.explorer}/address/${s.account}`,
  };
}

async function transfer(to, amount_eth) {
  const p = await hub('leash_prepare_transfer', { agent: AGENT, to, amountEth: String(amount_eth) });
  if (!p.ok) {
    if (p.reason !== 'over_allowance') return { status: p.reason, message: p.message ?? explain(p.reason) };
    return { status: 'over_allowance', remaining: eth(p.remaining), needed: eth(p.needed), proposedCap: p.proposedCap, proposedCapEth: p.proposedCapEth };
  }
  const signature = await sign({ hash: p.digest, privateKey: KEY, to: 'hex' });
  log(`sending ${p.valueEth} to ${p.toLabel ?? p.to}`);
  const r = await hub('leash_submit_transfer', { agent: AGENT, to: p.to, value: p.value, sessionNonce: p.sessionNonce, signature });
  if (r.status === 'confirmed') return { status: 'confirmed', sent: p.valueEth, to: p.toLabel ? `${p.toLabel} (${p.to})` : p.to, tx: r.link };
  return { status: r.status, message: r.reason ?? 'The transfer did not go through.', tx: r.link ?? null };
}

function explain(reason) {
  return (
    {
      unknown_session: 'This session key is not registered with the Leash hub.',
      unknown_recipient: 'Unknown recipient. Use a 0x address or a contact name from get_wallet.',
      bad_amount: 'The amount must be a positive number of ETH, like 0.000002.',
      expired: 'The session key has expired. The owner must issue a new one.',
      revoked: 'The owner revoked this session key.',
      insufficient_funds: 'The wallet itself does not hold enough ETH.',
    }[reason] ?? reason
  );
}

async function askForMore(newCapWei, reason, pending) {
  const r = await hub('leash_request_limit', { agent: AGENT, newCap: String(newCapWei), reason, transfer: pending ? { to: pending.to, value: pending.value } : undefined });
  if (!r.requestId) return { status: 'failed', message: r.reason };
  log(`limit request ${r.requestId}: ${eth(r.oldCap)} -> ${eth(r.newCap)}`);
  return { status: 'waiting_for_owner', request_id: r.requestId, current_total: eth(r.oldCap), requested_total: eth(r.newCap) };
}

// ---- tools --------------------------------------------------------------------------------

function createServer() {
  const server = new McpServer(
    { name: 'leash-agent', version: '0.1.0' },
    {
      instructions:
        'You control a Leash agent wallet on the Sepolia testnet. It holds a session key with a total ETH allowance ' +
        'and an expiry set by its owner. Call get_wallet first. Use send_eth for payments. If a payment is over the ' +
        'allowance, send_eth asks the owner for a higher limit automatically; then call wait_for_approval with the ' +
        'request_id, which sends the payment once the owner approves. Never claim a payment was sent unless a tool ' +
        'returned status "confirmed" with a tx link.',
    },
  );

  server.registerTool(
    'get_wallet',
    {
      title: 'Get wallet',
      description: 'The wallet this agent spends from: allowance left, total allowance, expiry, balance, and named contacts.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async () => reply(await wallet())),
  );

  server.registerTool(
    'send_eth',
    {
      title: 'Send ETH',
      description:
        'Send Sepolia ETH from the agent wallet, within its allowance. "to" is a 0x address or a contact name from get_wallet. ' +
        'Returns status "confirmed" with a tx link, or "waiting_for_owner" with a request_id when the owner must approve a higher limit.',
      inputSchema: {
        to: z.string().describe('0x address or contact name, e.g. ABC'),
        amount_eth: z.string().describe('Amount in ETH, e.g. "0.000002"'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    guarded(async ({ to, amount_eth }) => {
      const r = await transfer(to, amount_eth);
      if (r.status !== 'over_allowance') return reply(r);
      // Over the allowance: ask the owner for more, and remember the payment to send after.
      const ask = await askForMore(r.proposedCap, `Send ${amount_eth} ETH to ${to}. Only ${r.remaining} left.`, { to, value: parseEther(String(amount_eth)).toString() });
      if (ask.request_id) paused.set(ask.request_id, { to, amount_eth });
      return reply({
        ...ask,
        payment: `${amount_eth} ETH to ${to} (not sent yet)`,
        allowance_left: r.remaining,
        next: 'The owner was asked on their Leash stick. Call wait_for_approval with this request_id.',
      });
    }),
  );

  server.registerTool(
    'request_higher_limit',
    {
      title: 'Request a higher limit',
      description: "Ask the owner to raise this agent's total allowance, without a payment attached. The owner approves on their Leash stick.",
      inputSchema: {
        new_total_eth: z.string().describe('The new TOTAL allowance in ETH (not the extra amount)'),
        reason: z.string().describe('One sentence the owner will read'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guarded(async ({ new_total_eth, reason }) => {
      let wei;
      try {
        wei = parseEther(String(new_total_eth));
      } catch {
        return reply({ status: 'bad_amount' });
      }
      return reply(await askForMore(wei, reason, null));
    }),
  );

  server.registerTool(
    'wait_for_approval',
    {
      title: 'Wait for the owner',
      description:
        'Wait up to 45 seconds for the owner to decide a limit request. When it is approved and confirmed on-chain, ' +
        'any payment that was waiting on it is sent and its result returned. Call again if status is still "waiting".',
      inputSchema: { request_id: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    guarded(async ({ request_id }) => {
      const w = await hub('leash_wait_for_limit', { requestId: request_id, timeoutSeconds: 45 });
      const link = w.link ?? null;
      if (w.status === 'waiting' || w.status === 'submitting') {
        return reply({ status: w.status === 'waiting' ? 'waiting' : 'approved_confirming', message: 'Still waiting. Call wait_for_approval again.' });
      }
      if (w.status !== 'confirmed') {
        paused.delete(request_id);
        const msg = { rejected: 'The owner declined. The allowance is unchanged and the payment was not sent.', expired: 'Nobody answered in time. Nothing changed.', failed: `The raise failed: ${w.error ?? 'unknown error'}.`, unknown_request: 'No such request.' };
        return reply({ status: w.status, message: msg[w.status] ?? w.status });
      }
      const result = { status: 'approved', new_total: eth(w.newCap), limit_tx: link };
      const pending = paused.get(request_id);
      if (!pending) return reply(result);
      paused.delete(request_id);
      return reply({ ...result, payment: await transfer(pending.to, pending.amount_eth) });
    }),
  );

  return server;
}

// ---- HTTP ---------------------------------------------------------------------------------

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end(`leash agent mcp for ${AGENT ?? 'no session key yet'}\n`);
      return;
    }
    if (url.pathname !== PATH) {
      res.writeHead(404).end('not found');
      return;
    }
    const mcp = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void mcp.close();
    });
    try {
      await mcp.connect(transport);
      let body;
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
      }
      await transport.handleRequest(req, res, body);
    } catch (e) {
      log('mcp error', e?.message ?? e);
      if (!res.headersSent) res.writeHead(500).end();
    }
  })
  .listen(PORT, '0.0.0.0', () => {
    log(`leash agent mcp for ${AGENT ?? 'no session key yet'}`);
    log(`endpoint http://localhost:${PORT}${PATH}  hub ${HUB}`);
    if (!TOKEN) log('warning: no MCP_TOKEN set, so anyone with the URL can spend this allowance');
  });
