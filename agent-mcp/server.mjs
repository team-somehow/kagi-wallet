// Kagi agent MCP: an agent's wallet, as tools for ChatGPT, Claude or any MCP client.
//
// It talks to the chain directly. It signs spends with a Kagi session key and sends them itself,
// paying gas from the key's own address (the phone tops it up when it grants the key). The key
// can only spend its on-chain allowance. For more, it files a limit request on-chain; the
// owner's phone sees it and the owner approves on their stick.
//
// One server serves everyone. Each person's connector URL carries their own key:
//   /k/<account><key>      104 hex characters, what the Kagi app's "Copy connector link" gives
//   /k/kagi:0x…:0x…        the same, as the app's session key string
// The key only exists for the length of each request. Paths are never logged.
// A public demo wallet, for trying it without the app:
//   /demo                 spends from SESSION_KEY, the owner's demo key
//   SESSION_KEY  kagi:<account>:<0x key> (a bare 0x key works too, with KAGI_ACCOUNT set)
//   MCP_TOKEN    also serves SESSION_KEY at /mcp/<MCP_TOKEN>, the older private form
//   RPC_URL      default https://ethereum-sepolia-rpc.publicnode.com
//   EXPLORER     default https://sepolia.etherscan.io
//   CONTACTS     JSON name -> address; default contacts.json next to this file
//   MULTIBAAS_URL, MULTIBAAS_API_KEY  optional: Curvegrid MultiBaas, for get_activity (multibaas.mjs)
//   INTERCEPTA_API_KEY  optional: screen every destination before the key signs (intercepta.mjs)
//   PORT         default 8790
//   HOST         default 0.0.0.0; 127.0.0.1 behind a reverse proxy
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodePacked,
  formatEther,
  getAddress,
  http as httpTransport,
  isAddress,
  keccak256,
  parseEther,
} from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { z } from 'zod';
import { activity as mbActivity, multibaasEnabled, track } from './multibaas.mjs';
import { interceptaEnabled, screen } from './intercepta.mjs';

const here = (f) => new URL(f, import.meta.url);
const ABI = JSON.parse(readFileSync(here('./abi.json'), 'utf8'));
const RPC = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const EXPLORER = (process.env.EXPLORER ?? 'https://sepolia.etherscan.io').replace(/\/+$/, '');
const TOKEN = process.env.MCP_TOKEN?.trim() || null;
const PORT = Number(process.env.PORT ?? 8790);
// Behind a reverse proxy, set HOST=127.0.0.1 so only the proxy can reach it.
const HOST = process.env.HOST ?? '0.0.0.0';
const PATH = TOKEN ? `/mcp/${TOKEN}` : '/mcp';

// "kagi:<account>:<key>", or a bare key with KAGI_ACCOUNT.
function parseKey(raw) {
  const v = String(raw ?? '').trim();
  const m = /^kagi:(0x[0-9a-fA-F]{40}):(0x[0-9a-fA-F]{64})$/.exec(v);
  if (m) return { account: getAddress(m[1]), key: m[2] };
  const h = /^(?:0x)?([0-9a-fA-F]{40})([0-9a-fA-F]{64})$/.exec(v);
  if (h) return { account: getAddress(`0x${h[1]}`), key: `0x${h[2]}` };
  const acct = process.env.KAGI_ACCOUNT?.trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(v) && acct && isAddress(acct)) return { account: getAddress(acct), key: v };
  return null;
}
// The single-key endpoint's key, if this deployment has one.
const OWN = parseKey(process.env.SESSION_KEY);

const pub = createPublicClient({ transport: httpTransport(RPC) });
let chainId = null;
const getChainId = async () => (chainId ??= await pub.getChainId());

const contacts = () => {
  if (process.env.CONTACTS) return JSON.parse(process.env.CONTACTS);
  return existsSync(here('./contacts.json')) ? JSON.parse(readFileSync(here('./contacts.json'), 'utf8')) : {};
};

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const eth = (wei) => `${formatEther(BigInt(wei))} ETH`;
const txLink = (h) => `${EXPLORER}/tx/${h}`;

function why(e) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r?.reason) return r.reason;
    if (/insufficient funds/i.test(e.message)) return 'no_gas';
    return e.shortMessage;
  }
  return e?.message ?? String(e);
}

// Limit requests filed through this server: "<agent>:<request_id>" -> what it asked, and any paused payment.
const requests = new Map();
// Accounts already checked to hold a Kagi contract.
const ACCOUNTS = new Set();

const reply = (data) => {
  const clean = JSON.parse(JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
  return { content: [{ type: 'text', text: JSON.stringify(clean, null, 2) }], structuredContent: clean };
};
/** Everything one session key can do. The MCP tools call into this. */
function forKey(parsed) {
  const KEY = parsed.key;
  const ACCOUNT = parsed.account;
  const AGENT = privateKeyToAccount(KEY);
  const wallet = createWalletClient({ account: AGENT, transport: httpTransport(RPC) });

  // ---- chain ------------------------------------------------------------------------------

  async function state() {
    if (!ACCOUNTS.has(ACCOUNT)) {
      const code = await pub.getCode({ address: ACCOUNT });
      if (!code || code === '0x') throw new Error(`There is no Kagi account at ${ACCOUNT} on this network. Copy the key again from the Kagi phone app.`);
      ACCOUNTS.add(ACCOUNT);
      track(ACCOUNT, ABI); // start MultiBaas indexing now, so get_activity has the history later
    }
    const [[cap, spent, expiry, nonce], balance, gas, block] = await Promise.all([
      pub.readContract({ address: ACCOUNT, abi: ABI, functionName: 'session', args: [AGENT.address] }),
      pub.getBalance({ address: ACCOUNT }),
      pub.getBalance({ address: AGENT.address }),
      pub.getBlock(),
    ]);
    const status = cap === 0n && expiry === 0n ? 'unknown' : expiry === 0n ? 'revoked' : expiry <= block.timestamp ? 'expired' : 'active';
    return { cap, spent, expiry, nonce, balance, gas, now: block.timestamp, block: block.number, status, remaining: cap > spent ? cap - spent : 0n };
  }

  /** Simulate, send from the agent's own key (it pays the gas), and wait for the receipt. */
  async function send(functionName, args) {
    const req = { account: AGENT, address: ACCOUNT, abi: ABI, functionName, args };
    const { request } = await pub.simulateContract(req);
    const b = await pub.getBlock();
    const tip = 1_000_000n;
    const hash = await wallet.writeContract({ ...request, chain: null, maxPriorityFeePerGas: tip, maxFeePerGas: (b.baseFeePerGas * 125n) / 100n + tip });
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    return { hash, status: r.status, block: r.blockNumber };
  }

  function resolveRecipient(to) {
    if (isAddress(to)) return { address: getAddress(to), label: null };
    const book = contacts();
    const key = Object.keys(book).find((k) => k.toLowerCase() === String(to).trim().toLowerCase());
    return key ? { address: getAddress(book[key]), label: key } : null;
  }

  async function walletInfo() {
    const s = await state();
    if (s.status === 'unknown') return { ok: false, error: 'This session key has no session on that Kagi account. Create the key from the Kagi phone app.' };
    return {
      ok: true,
      session_key_address: AGENT.address,
      wallet: ACCOUNT,
      status: s.status,
      allowance_left: eth(s.remaining),
      allowance_total: eth(s.cap),
      spent: eth(s.spent),
      expires_in_minutes: Math.max(0, Math.round(Number(s.expiry - s.now) / 60)),
      wallet_balance: eth(s.balance),
      gas_left: eth(s.gas),
      contacts: contacts(),
      explorer: `${EXPLORER}/address/${ACCOUNT}`,
    };
  }

  const EXPLAIN = {
    unknown_recipient: 'Unknown recipient. Use a 0x address or a contact name from get_wallet.',
    bad_amount: 'The amount must be a positive number of ETH, like 0.000002.',
    expired: 'The session key has expired. The owner must issue a new one.',
    revoked: 'The owner revoked this session key.',
    unknown: 'This session key has no session on that Kagi account.',
    insufficient_funds: 'The wallet itself does not hold enough ETH.',
    no_gas: `The agent key has no test ETH left for gas. Send a little to ${'${agent}'}.`,
  };
  const explain = (r) => (EXPLAIN[r] ?? r).replace('${agent}', AGENT?.address ?? 'the agent key');

  /**
   * Pay `to`. Intercepta screens the destination first, unless the owner already approved this
   * exact payment after seeing its verdict (`approved`).
   */
  async function transfer(to, amount_eth, { approved = false } = {}) {
    const rcpt = resolveRecipient(to);
    if (!rcpt) return { status: 'unknown_recipient', message: explain('unknown_recipient'), contacts: Object.keys(contacts()) };
    let value;
    try {
      value = parseEther(String(amount_eth));
    } catch {
      return { status: 'bad_amount', message: explain('bad_amount') };
    }
    if (value <= 0n) return { status: 'bad_amount', message: explain('bad_amount') };
    const s = await state();
    if (s.status !== 'active') return { status: s.status, message: explain(s.status) };
    // Screen who gets paid before anything is signed. The verdict decides the next step.
    let risk = null;
    if (!approved && interceptaEnabled()) {
      risk = await screen(rcpt.address);
      log(`intercepta: ${risk.verdict}, ${risk.summary}`);
      if (risk.verdict === 'block') {
        return {
          status: 'blocked',
          message: `Refused before signing: Intercepta flagged ${rcpt.address} (${risk.summary}). Nothing was sent and the owner was not asked.`,
          intercepta: risk,
        };
      }
      if (risk.verdict === 'hold') {
        // Held even under the cap: ask for exactly this payment more, so only the owner's
        // phone and stick can let it through.
        return { status: 'held', needed: value, proposedCap: s.cap + value, remaining: s.remaining, intercepta: risk, to: rcpt.address };
      }
    }
    if (value > s.remaining) {
      // Propose a total that covers this transfer with room to spare: double what it needs.
      return { status: 'over_allowance', remaining: s.remaining, needed: value, proposedCap: (s.spent + value) * 2n, cap: s.cap, intercepta: risk };
    }
    if (value > s.balance) return { status: 'insufficient_funds', message: explain('insufficient_funds') };
    const digest = keccak256(
      encodePacked(
        ['string', 'uint256', 'address', 'address', 'uint256', 'address', 'uint256'],
        ['KAGI/spend', BigInt(await getChainId()), ACCOUNT, AGENT.address, s.nonce, rcpt.address, value],
      ),
    );
    const sig = await sign({ hash: digest, privateKey: KEY });
    log(`sending ${eth(value)} to ${rcpt.label ?? rcpt.address}`);
    try {
      const r = await send('spend', [AGENT.address, rcpt.address, value, Number(sig.v), sig.r, sig.s]);
      const shown = rcpt.label ? `${rcpt.label} (${rcpt.address})` : rcpt.address;
      if (r.status === 'success') {
        const screened = approved ? 'approved by the owner after an Intercepta hold' : risk ? `Intercepta: ${risk.summary}` : undefined;
        return { status: 'confirmed', sent: eth(value), to: shown, tx: txLink(r.hash), ...(screened ? { screened } : {}) };
      }
      return { status: 'failed', message: 'The transfer reverted on-chain.', tx: txLink(r.hash) };
    } catch (e) {
      const w = why(e);
      return { status: w === 'no_gas' ? 'no_gas' : 'failed', message: w === 'no_gas' ? explain('no_gas') : w };
    }
  }


  async function askForMore(newCap, reason, payment) {
    try {
      const r = await send('requestLimit', [newCap, String(reason).slice(0, 200)]);
      if (r.status !== 'success') return { status: 'failed', message: 'The request reverted on-chain.' };
      const s = await state();
      requests.set(`${AGENT.address}:${r.hash}`, { newCap, fromBlock: r.block, payment });
      log(`limit request ${r.hash}: ${eth(s.cap)} -> ${eth(newCap)}`);
      return { status: 'waiting_for_owner', request_id: r.hash, current_total: eth(s.cap), requested_total: eth(newCap), request_tx: txLink(r.hash) };
    } catch (e) {
      const w = why(e);
      return { status: w === 'no_gas' ? 'no_gas' : 'failed', message: w === 'no_gas' ? explain('no_gas') : w };
    }
  }

  /** A request's newCap and block, from memory or from its own transaction. */
  async function lookup(id) {
    const k = `${AGENT.address}:${id}`;
    if (requests.has(k)) return requests.get(k);
    try {
      const rc = await pub.getTransactionReceipt({ hash: id });
      for (const l of rc.logs) {
        if (l.address.toLowerCase() !== ACCOUNT.toLowerCase()) continue;
        try {
          const d = decodeEventLog({ abi: ABI, data: l.data, topics: l.topics });
          if (d.eventName === 'LimitRequested' && d.args.agent.toLowerCase() === AGENT.address.toLowerCase()) {
            const r = { newCap: d.args.newCap, fromBlock: rc.blockNumber, payment: null };
            requests.set(k, r);
            return r;
          }
        } catch {
          // another event
        }
      }
    } catch {
      // not a transaction
    }
    return null;
  }

  // Nobody answered after about ten minutes of blocks: the request lapses, the old limit stands.
  const REQUEST_BLOCKS = 50n;

  /** Poll the chain for the owner's answer: a raise that covers it, or a decline. */
  async function waitForOwner(id, seconds) {
    const req = await lookup(id);
    if (!req) return { status: 'unknown_request' };
    const until = Date.now() + seconds * 1000;
    for (;;) {
      const s = await state();
      if (s.cap >= req.newCap) {
        const raised = await pub.getContractEvents({ address: ACCOUNT, abi: ABI, eventName: 'LimitRaised', args: { agent: AGENT.address }, fromBlock: req.fromBlock });
        return { status: 'confirmed', newCap: s.cap, hash: raised.at(-1)?.transactionHash ?? null };
      }
      const declined = await pub.getContractEvents({ address: ACCOUNT, abi: ABI, eventName: 'LimitDeclined', args: { agent: AGENT.address }, fromBlock: req.fromBlock });
      const no = declined.find((d) => d.args.newCap === req.newCap);
      if (no) return { status: 'rejected', hash: no.transactionHash };
      if (s.status !== 'active' || s.block - req.fromBlock > REQUEST_BLOCKS) return { status: 'expired' };
      if (Date.now() > until) return { status: 'waiting' };
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  /** The account's history from MultiBaas: every spend, request, raise, decline, grant and revoke. */
  async function history() {
    const { justLinked, rows } = await mbActivity(ACCOUNT, ABI);
    const me = AGENT.address.toLowerCase();
    const who = (a) => (!a ? null : a.toLowerCase() === me ? 'this agent' : a);
    const describe = (r) => {
      switch (r.event) {
        case 'Spent': return `${who(r.agent)} sent ${eth(r.value)} to ${r.to}`;
        case 'LimitRequested': return `${who(r.agent)} asked to raise its limit ${eth(r.oldCap)} -> ${eth(r.newCap)}: "${r.reason}"`;
        case 'LimitRaised': return `owner approved ${who(r.agent)}: limit ${eth(r.oldCap)} -> ${eth(r.newCap)} (phone + stick signed)`;
        case 'LimitDeclined': return `owner declined ${who(r.agent)}'s request for ${eth(r.newCap)}`;
        case 'Granted': return `owner granted ${who(r.agent)} a key with a ${eth(r.cap)} limit (phone + stick signed)`;
        case 'Revoked': return `owner revoked ${who(r.agent)}`;
        default: return r.event;
      }
    };
    return {
      ok: true,
      source: 'Curvegrid MultiBaas event index',
      wallet: ACCOUNT,
      ...(justLinked ? { note: 'This wallet was just added to the index. Older events can take a minute to appear; call again shortly.' } : {}),
      events: rows.map((r) => ({ what: describe(r), event: r.event, at: r.at, tx: r.tx ? txLink(r.tx) : null })),
    };
  }

  return { AGENT, ACCOUNT, walletInfo, transfer, askForMore, waitForOwner, history, requestsKey: (id) => `${AGENT.address}:${id}` };
}

// ---- tools --------------------------------------------------------------------------------

const NO_KEY = {
  ok: false,
  status: 'not_configured',
  error:
    'No wallet is connected yet. Ask the user for the session key from the Kagi phone app (Copy session key only, ' +
    'it starts with kagi:) and call use_my_key with it, or have them add their own connector link instead.',
};

/**
 * The MCP server for one connection. current() gives the agent it acts for (null: none yet).
 * With setKey, the connection can switch to the user's own key through use_my_key.
 */
function buildServer(current, setKey) {
  // Every tool goes through this, so a failure comes back as a clear reply, not a crash.
  const guarded = (fn) => async (args) => {
    const a = current();
    if (!a) return reply(NO_KEY);
    try {
      return await fn(a, args);
    } catch (e) {
      return reply({ ok: false, status: 'error', error: why(e) });
    }
  };

  const server = new McpServer(
    { name: 'kagi-agent', version: '0.2.0' },
    {
      instructions:
        'You control a Kagi agent wallet on-chain. It holds a session key with a total ETH allowance ' +
        'and an expiry set by its owner. Call get_wallet first. Use send_eth for payments. If a payment is over the ' +
        'allowance, send_eth asks the owner for a higher limit automatically; then call wait_for_approval with the ' +
        'request_id, which sends the payment once the owner approves. ' +
        (interceptaEnabled()
          ? 'Every recipient is screened by Intercepta before the key signs: status "blocked" means the payment was refused ' +
            '(tell the user why, and do not retry or route around it); "waiting_for_owner" with held_by "intercepta" means the ' +
            'owner must approve that payment. '
          : '') +
        (multibaasEnabled() ? 'get_activity shows the wallet history: past payments, requests and approvals. ' : '') +
        'Never claim a payment was sent unless a tool ' +
        'returned status "confirmed" with a tx link.' +
        (setKey ? ' If the user gives you a Kagi session key (kagi:0x…:0x…), call use_my_key with it to spend from their own wallet.' : ''),
    },
  );

  if (setKey) {
    server.registerTool(
      'use_my_key',
      {
        title: 'Use my Kagi key',
        description:
          "Switch this connection to the user's own Kagi wallet. Pass the session key they copied from the Kagi phone app " +
          '(Copy session key only), which looks like kagi:0x…:0x…. It lasts for this connection.',
        inputSchema: { session_key: z.string().describe('kagi:<account>:<key>, exactly as the Kagi app copies it') },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async ({ session_key }) => {
        const parsed = parseKey(session_key);
        if (!parsed) return reply({ ok: false, status: 'bad_key', error: 'That is not a Kagi session key. It looks like kagi:0x…:0x…, copied from the Kagi app.' });
        const a = forKey(parsed);
        let w;
        try {
          w = await a.walletInfo();
        } catch (e) {
          return reply({ ok: false, status: 'error', error: why(e) });
        }
        if (!w.ok) return reply(w);
        setKey(a);
        log('a connection switched to its own key');
        return reply({ ...w, connected: true, note: 'Connected to your wallet for this connection. Next time, add your connector link from the Kagi app so the key stays out of the chat.' });
      },
    );
  }

  server.registerTool(
    'get_wallet',
    {
      title: 'Get wallet',
      description: 'The wallet this agent spends from: allowance left, total allowance, expiry, balance, and named contacts.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async (a) => reply(await a.walletInfo())),
  );

  if (multibaasEnabled()) {
    server.registerTool(
      'get_activity',
      {
        title: 'Get activity',
        description:
          "The wallet's history, newest first, from the Curvegrid MultiBaas event index: every payment an agent sent, " +
          'every limit it asked for, and whether the owner approved (phone + stick), declined or revoked. Use it to answer ' +
          '"what did my agent spend?" or "who approved that?".',
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      guarded(async (a) => reply(await a.history())),
    );
  }

  server.registerTool(
    'send_eth',
    {
      title: 'Send ETH',
      description:
        'Send test ETH from the agent wallet, within its allowance. "to" is a 0x address or a contact name from get_wallet. ' +
        'Returns status "confirmed" with a tx link, or "waiting_for_owner" with a request_id when the owner must approve a higher limit.',
      inputSchema: {
        to: z.string().describe('0x address or contact name, e.g. ABC'),
        amount_eth: z.string().describe('Amount in ETH, e.g. "0.000002"'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    guarded(async (a, { to, amount_eth }) => {
      const r = await a.transfer(to, amount_eth);
      if (r.status === 'held') {
        // Intercepta wants a person to decide. The reason travels with the on-chain request,
        // so the owner reads it on their phone before approving on the stick.
        const short = `${r.to.slice(0, 6)}…${r.to.slice(-4)}`;
        const why = `Intercepta held: ${r.intercepta.summary}. Pay ${amount_eth} ETH to ${short}?`;
        const ask = await a.askForMore(r.proposedCap, why.slice(0, 200), { to, amount_eth, approved: true });
        if (ask.status !== 'waiting_for_owner') return reply({ ...ask, intercepta: r.intercepta });
        return reply({
          ...ask,
          held_by: 'intercepta',
          intercepta: r.intercepta,
          payment: `${amount_eth} ETH to ${to} (not sent: held for the owner)`,
          next: 'Intercepta flagged this recipient, so the owner must approve it on their Kagi phone and stick. Call wait_for_approval with this request_id.',
        });
      }
      if (r.status !== 'over_allowance') return reply(r);
      // Over the allowance: ask the owner for more on-chain, and remember the payment to send after.
      const screened = r.intercepta ? ` Intercepta: ${r.intercepta.summary}.` : '';
      const ask = await a.askForMore(r.proposedCap, `Send ${amount_eth} ETH to ${to}. Only ${eth(r.remaining)} left.${screened}`.slice(0, 200), { to, amount_eth });
      if (ask.status !== 'waiting_for_owner') return reply(ask);
      return reply({
        ...ask,
        payment: `${amount_eth} ETH to ${to} (not sent yet)`,
        allowance_left: eth(r.remaining),
        next: 'The owner was asked on their Kagi phone and stick. Call wait_for_approval with this request_id.',
      });
    }),
  );

  server.registerTool(
    'request_higher_limit',
    {
      title: 'Request a higher limit',
      description: "Ask the owner to raise this agent's total allowance, without a payment attached. The owner approves on their Kagi stick.",
      inputSchema: {
        new_total_eth: z.string().describe('The new TOTAL allowance in ETH (not the extra amount)'),
        reason: z.string().describe('One sentence the owner will read'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    guarded(async (a, { new_total_eth, reason }) => {
      let wei;
      try {
        wei = parseEther(String(new_total_eth));
      } catch {
        return reply({ status: 'bad_amount' });
      }
      return reply(await a.askForMore(wei, reason, null));
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
    guarded(async (a, { request_id }) => {
      const w = await a.waitForOwner(request_id, 45);
      if (w.status === 'waiting') return reply({ status: 'waiting', message: 'Still waiting for the owner. Call wait_for_approval again.' });
      const req = requests.get(a.requestsKey(request_id));
      if (w.status !== 'confirmed') {
        if (req) req.payment = null;
        const msg = {
          rejected: 'The owner declined. The allowance is unchanged and the payment was not sent.',
          expired: 'Nobody answered in time. Nothing changed and the payment was not sent.',
          unknown_request: 'No such request.',
        };
        return reply({ status: w.status, message: msg[w.status] ?? w.status, tx: w.hash ? txLink(w.hash) : null });
      }
      const result = { status: 'approved', new_total: eth(w.newCap), limit_tx: w.hash ? txLink(w.hash) : null };
      const pending = req?.payment;
      if (!pending) return reply(result);
      req.payment = null;
      return reply({ ...result, payment: await a.transfer(pending.to, pending.amount_eth, { approved: Boolean(pending.approved) }) });
    }),
  );

  return server;
}

// ---- HTTP ---------------------------------------------------------------------------------

async function readBody(req) {
  if (req.method !== 'POST') return undefined;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
}

// /demo keeps a session per connection, so use_my_key can switch it to the user's key.
// In memory only: a restart forgets them, and the client simply starts a new session.
const sessions = new Map(); // mcp-session-id -> { transport, agent, seen }
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, x] of sessions) if (now - x.seen > SESSION_IDLE_MS) void x.transport.close();
}, 60_000).unref();

async function demo(req, res) {
  const body = await readBody(req);
  const sid = req.headers['mcp-session-id'];
  const known = typeof sid === 'string' ? sessions.get(sid) : null;
  if (known) {
    known.seen = Date.now();
    return known.transport.handleRequest(req, res, body);
  }
  if (sid) {
    res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session expired. Reconnect.' }, id: null }));
    return;
  }
  const entry = { transport: null, agent: OWN ? forKey(OWN) : null, seen: Date.now() };
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id) => sessions.set(id, entry),
  });
  entry.transport = transport;
  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };
  const server = buildServer(() => entry.agent, (a) => (entry.agent = a));
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

// /k/<token>: the key is in the link, so every request stands alone.
async function stateless(req, res, agent) {
  const server = buildServer(() => agent, null);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, await readBody(req));
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    try {
      if (url.pathname === '/' || url.pathname === '/health') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('kagi agent mcp: connect at /demo, or /k/<your connector token>\n');
        return;
      }
      if (url.pathname.startsWith('/k/')) {
        const parsed = parseKey(decodeURIComponent(url.pathname.slice(3)));
        if (parsed) return await stateless(req, res, forKey(parsed));
      } else if (url.pathname === '/demo' || (TOKEN && url.pathname === PATH)) {
        return await demo(req, res);
      }
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not a Kagi connector link. Copy it again from the Kagi app.\n');
    } catch (e) {
      log('mcp error', e?.message ?? e);
      if (!res.headersSent) res.writeHead(500).end();
    }
  })
  .listen(PORT, HOST, () => {
    log(`kagi agent mcp on ${HOST}:${PORT}, rpc ${RPC}`);
    log('shared endpoint: /k/<connector token>');
    log(OWN ? `public demo at /demo spends from ${privateKeyToAccount(OWN.key).address}` : 'public demo at /demo: no demo key set, use_my_key only');
  });
