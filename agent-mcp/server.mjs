// Kagi agent MCP: an agent's wallet, as tools for ChatGPT, Claude or any MCP client.
//
// It talks to Sepolia directly. It signs spends with a Kagi session key and sends them itself,
// paying gas from the key's own address (the phone tops it up when it grants the key). The key
// can only spend its on-chain allowance. For more, it files a limit request on-chain; the
// owner's phone sees it and the owner approves on their stick.
//
// One server serves everyone. Each person's connector URL carries their own key:
//   /k/<account><key>      104 hex characters, what the Kagi app's "Copy connector link" gives
//   /k/kagi:0x…:0x…        the same, as the app's session key string
// The key only exists for the length of each request. Paths are never logged.
// A single-key endpoint also exists for one owner's own deployment:
//   SESSION_KEY  kagi:<account>:<0x key> (a bare 0x key works too, with KAGI_ACCOUNT set)
//   MCP_TOKEN    the endpoint becomes /mcp/<MCP_TOKEN>
//   RPC_URL      default https://ethereum-sepolia-rpc.publicnode.com
//   EXPLORER     default https://sepolia.etherscan.io
//   CONTACTS     JSON name -> address; default contacts.json next to this file
//   PORT         default 8790
import http from 'node:http';
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

const here = (f) => new URL(f, import.meta.url);
const ABI = JSON.parse(readFileSync(here('./abi.json'), 'utf8'));
const RPC = process.env.RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const EXPLORER = (process.env.EXPLORER ?? 'https://sepolia.etherscan.io').replace(/\/+$/, '');
const TOKEN = process.env.MCP_TOKEN?.trim() || null;
const PORT = Number(process.env.PORT ?? 8790);
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
/** Everything one session key can do, as an MCP server. */
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
    no_gas: `The agent key has no Sepolia ETH left for gas. Send a little to ${'${agent}'}.`,
  };
  const explain = (r) => (EXPLAIN[r] ?? r).replace('${agent}', AGENT?.address ?? 'the agent key');

  async function transfer(to, amount_eth) {
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
    if (value > s.remaining) {
      // Propose a total that covers this transfer with room to spare: double what it needs.
      return { status: 'over_allowance', remaining: s.remaining, needed: value, proposedCap: (s.spent + value) * 2n, cap: s.cap };
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
      if (r.status === 'success') return { status: 'confirmed', sent: eth(value), to: shown, tx: txLink(r.hash) };
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

  // ---- tools --------------------------------------------------------------------------------

  function createServer() {
    // Every tool goes through this, so a failure comes back as a clear reply, not a crash.
    const guarded = (fn) => async (args) => {
      try {
        return await fn(args);
      } catch (e) {
        return reply({ ok: false, status: 'error', error: why(e) });
      }
    };

    const server = new McpServer(
      { name: 'kagi-agent', version: '0.1.0' },
      {
        instructions:
          'You control a Kagi agent wallet on the Sepolia testnet. It holds a session key with a total ETH allowance ' +
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
      guarded(async () => reply(await walletInfo())),
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
        // Over the allowance: ask the owner for more on-chain, and remember the payment to send after.
        const ask = await askForMore(r.proposedCap, `Send ${amount_eth} ETH to ${to}. Only ${eth(r.remaining)} left.`, { to, amount_eth });
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
        const w = await waitForOwner(request_id, 45);
        if (w.status === 'waiting') return reply({ status: 'waiting', message: 'Still waiting for the owner. Call wait_for_approval again.' });
        const req = requests.get(`${AGENT.address}:${request_id}`);
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
        return reply({ ...result, payment: await transfer(pending.to, pending.amount_eth) });
      }),
    );

    return server;
  }
  return createServer();
}

// ---- HTTP ---------------------------------------------------------------------------------

http
  .createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('kagi agent mcp: connect at /k/<your connector token>\n');
      return;
    }
    let parsed = null;
    if (url.pathname.startsWith('/k/')) parsed = parseKey(decodeURIComponent(url.pathname.slice(3)));
    else if (url.pathname === PATH && OWN) parsed = OWN;
    if (!parsed) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not a Kagi connector link. Copy it again from the Kagi app.\n');
      return;
    }
    const mcp = forKey(parsed);
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
    log(`kagi agent mcp on :${PORT}, rpc ${RPC}`);
    log('shared endpoint: /k/<connector token>');
    if (OWN) log(`single-key endpoint for ${privateKeyToAccount(OWN.key).address}: ${TOKEN ? '/mcp/<MCP_TOKEN>' : '/mcp (no MCP_TOKEN: anyone with the URL can spend this allowance)'}`);
  });
