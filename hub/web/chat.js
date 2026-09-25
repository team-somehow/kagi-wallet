// The Leash demo agent in the browser. It holds the session key in memory, signs spends
// itself and talks to the Leash MCP. A transfer above the allowance asks the owner for a
// higher limit, waits for the stick and the chain, then retries the same transfer.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { formatEther } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';

const $ = (id) => document.getElementById(id);
let key = null; // the session private key: this closure only, never logged or sent
let agent = null; // its address
let session = null;
let mcp = null;
let busy = false;

const eth = (wei) => `${formatEther(BigInt(wei))} ETH`;
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;

async function tool(name, args) {
  if (!mcp) {
    mcp = new Client({ name: 'leash-web-chat', version: '0.1.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL('/mcp', location.href)));
  }
  const r = await mcp.callTool({ name, arguments: args });
  return r.structuredContent ?? JSON.parse(r.content?.[0]?.text ?? '{}');
}

function say(html, cls = '') {
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  el.innerHTML = html;
  $('log').appendChild(el);
  $('log').scrollTop = $('log').scrollHeight;
  return el;
}

function status(el, html, cls) {
  let st = el.querySelector('.status');
  if (!st) {
    st = document.createElement('div');
    st.className = 'status';
    el.appendChild(st);
  }
  st.innerHTML = html;
  el.className = `msg ${cls ?? ''}`;
  $('log').scrollTop = $('log').scrollHeight;
}

const link = (hash) => `<a href="https://sepolia.etherscan.io/tx/${hash}" target="_blank" rel="noopener">${short(hash)}</a>`;

async function refresh() {
  session = await tool('leash_session', { agent });
  if (!session.found) return;
  $('sName').textContent = session.name;
  $('sWallet').textContent = short(session.account);
  $('sWallet').href = `https://sepolia.etherscan.io/address/${session.account}`;
  $('sLeft').textContent = session.remainingEth;
  $('sCap').textContent = session.capEth;
  const mins = Math.round((session.expiry - session.now) / 60);
  $('sExp').textContent = session.status !== 'active' ? session.status : mins > 90 ? `in ${Math.round(mins / 60)} h` : `in ${mins} min`;
  const cap = BigInt(session.cap);
  const pct = cap > 0n ? Number((BigInt(session.remaining) * 1000n) / cap) / 10 : 0;
  $('sBar').firstElementChild.style.width = `${pct}%`;
  $('sBar').classList.toggle('hot', pct <= 20);
}

async function connect() {
  const raw = $('key').value.trim();
  $('connectError').classList.add('hidden');
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) {
    $('connectError').textContent = 'That does not look like a session key. It is 64 hex characters, copied from the Leash phone.';
    $('connectError').classList.remove('hidden');
    return;
  }
  key = raw.startsWith('0x') ? raw : `0x${raw}`;
  $('key').value = '';
  agent = privateKeyToAccount(key).address;
  $('connect').disabled = true;
  try {
    await refresh();
  } catch (e) {
    key = null;
    $('connect').disabled = false;
    $('connectError').textContent = `Could not reach the Leash MCP: ${e.message}`;
    $('connectError').classList.remove('hidden');
    return;
  }
  if (!session.found) {
    key = null;
    $('connect').disabled = false;
    $('connectError').textContent = 'No Leash wallet has granted this key. Create a session key on the phone first.';
    $('connectError').classList.remove('hidden');
    return;
  }
  $('connectCard').classList.add('hidden');
  $('sessionCard').classList.remove('hidden');
  $('input').disabled = false;
  $('send').disabled = false;
  $('input').focus();
  say(`Connected to <b>${session.name}</b> on Sepolia. ${session.remainingEth} left of ${session.capEth}.`);
}

function disconnect() {
  key = null;
  agent = null;
  session = null;
  $('sessionCard').classList.add('hidden');
  $('connectCard').classList.remove('hidden');
  $('connect').disabled = false;
  $('input').disabled = true;
  $('send').disabled = true;
  say('Disconnected. The key is gone from this tab.');
}

// "Send 0.000002 ETH to ABC, then send 0.000008 ETH to ABC"
function parse(text) {
  const parts = text.split(/\s*(?:,\s*)?(?:\band then\b|\bthen\b|;)\s*/i).filter(Boolean);
  const steps = [];
  for (const p of parts) {
    const m = p.match(/send\s+([0-9]*\.?[0-9]+)\s*(?:eth)?\s+to\s+(0x[0-9a-fA-F]{40}|[A-Za-z][\w-]*)/i);
    if (!m) return null;
    steps.push({ amount: m[1], to: m[2] });
  }
  return steps.length ? steps : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One transfer. Resolves true when it confirmed, false when the plan should stop. */
async function transfer(step) {
  const el = say(`Send <span class="mono">${step.amount} ETH</span> to <b>${step.to}</b>`);
  for (let attempt = 0; attempt < 3; attempt++) {
    status(el, 'Checking the allowance…');
    const p = await tool('leash_prepare_transfer', { agent, to: step.to, amountEth: step.amount });
    if (p.ok) {
      status(el, `<span class="token"></span> Signing and sending…`);
      const signature = await sign({ hash: p.digest, privateKey: key, to: 'hex' });
      const r = await tool('leash_submit_transfer', { agent, to: p.to, value: p.value, sessionNonce: p.sessionNonce, signature });
      if (r.status === 'confirmed') {
        status(el, `Confirmed on Sepolia: ${link(r.hash)}`);
        await refresh();
        return true;
      }
      if (r.status === 'stale') continue; // an earlier attempt landed or the session moved: re-check
      if (r.reason === 'over_allowance') continue;
      status(el, `Failed: ${r.reason ?? 'unknown error'}. Nothing was sent.`, 'bad');
      return false;
    }
    if (p.reason === 'unknown_recipient') {
      status(el, `${p.message} Tell me the 0x address, or use a known contact.`, 'bad');
      return false;
    }
    if (p.reason === 'expired' || p.reason === 'revoked') {
      status(el, `The session key is ${p.reason}. Ask the owner for a new one.`, 'bad');
      return false;
    }
    if (p.reason === 'insufficient_funds') {
      status(el, `The wallet holds only ${eth(p.balance)}. Top it up and try again.`, 'bad');
      return false;
    }
    if (p.reason !== 'over_allowance') {
      status(el, `Can't send: ${p.reason}.`, 'bad');
      return false;
    }
    // Over the allowance: ask for more total access and wait for the owner.
    const ask = await tool('leash_request_limit', {
      agent,
      newCap: p.proposedCap,
      reason: `send ${step.amount} ETH to ${step.to}`,
      transfer: { to: step.to, value: p.needed },
    });
    if (ask.status === 'failed') {
      status(el, `Couldn't ask for a higher limit: ${ask.reason}`, 'bad');
      return false;
    }
    status(
      el,
      `<span class="pulse"></span>Only ${eth(p.remaining)} left. Waiting for the owner to raise the total limit to ${p.proposedCapEth} on the Leash stick.`,
      'wait',
    );
    let w;
    const deadline = Date.now() + 5 * 60_000;
    do {
      w = await tool('leash_wait_for_limit', { requestId: ask.requestId, timeoutSeconds: 50 });
      if (w.status === 'submitting') status(el, `<span class="pulse"></span>Approved on the stick. Waiting for Sepolia to confirm the new limit…`, 'wait');
    } while ((w.status === 'waiting' || w.status === 'submitting') && Date.now() < deadline);
    if (w.status === 'confirmed') {
      status(el, `Limit raised to ${p.proposedCapEth}: ${link(w.hash)}. Retrying the transfer…`);
      await refresh();
      await sleep(400);
      continue;
    }
    if (w.status === 'rejected') status(el, `The owner declined. The limit stays at ${session.capEth} and nothing was sent.`, 'bad');
    else if (w.status === 'expired' || w.status === 'waiting') status(el, 'No answer from the owner in time. Nothing was sent.', 'bad');
    else status(el, `The limit change failed${w.error ? `: ${w.error}` : ''}. Nothing was sent.`, 'bad');
    await refresh();
    return false;
  }
  status(el, 'Gave up after several attempts. Nothing more was sent.', 'bad');
  return false;
}

async function run(text) {
  if (busy || !key) return;
  say(text.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]), 'me');
  const steps = parse(text);
  if (!steps) {
    say('I only do plain ETH transfers for now. Try: <span class="mono">Send 0.000002 ETH to ABC</span>.');
    return;
  }
  busy = true;
  $('send').disabled = true;
  try {
    for (const [i, s] of steps.entries()) {
      const done = await transfer(s);
      if (!done) {
        if (i < steps.length - 1) say('Stopped here. The remaining steps were not sent.');
        break;
      }
    }
  } catch (e) {
    say(`Something went wrong: ${e.message}. Nothing more was sent.`, 'bad');
  } finally {
    busy = false;
    $('send').disabled = false;
  }
}

$('connect').addEventListener('click', () => void connect());
$('key').addEventListener('keydown', (e) => e.key === 'Enter' && void connect());
$('disconnect').addEventListener('click', disconnect);
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  const t = $('input').value.trim();
  $('input').value = '';
  if (t) void run(t);
});
for (const c of document.querySelectorAll('.chip')) c.addEventListener('click', () => void run(c.dataset.text));
