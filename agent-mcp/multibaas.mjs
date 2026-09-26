// Curvegrid MultiBaas: the account's history, indexed. The chain only answers "what is the
// state now"; MultiBaas keeps every Spent, LimitRequested, LimitRaised, LimitDeclined, Granted
// and Revoked event, so an agent (or its owner) can ask what happened and who approved it.
//
// Accounts are deployed per user by their phone, so they can't be linked ahead of time. The
// first time an account uses this server, track() registers the KagiAccount ABI (once per
// deployment), gives the address an alias, and links it with event indexing on. The free plan
// indexes at most 100 blocks back, so history starts about 20 minutes before that first call;
// linking early (on any tool, not only get_activity) is what makes the history complete.
//
//   MULTIBAAS_URL      https://<deployment>.multibaas.com
//   MULTIBAAS_API_KEY  an API key in the deployment's Administrators or Members group
//   MULTIBAAS_START    how far back to index a newly linked account, default -100 (the free plan's maximum)

const BASE = process.env.MULTIBAAS_URL?.trim().replace(/\/+$/, '') || null;
const KEY = process.env.MULTIBAAS_API_KEY?.trim() || null;
const START = process.env.MULTIBAAS_START?.trim() || '-100';
const LABEL = 'kagi_account';
const VERSION = '1.0';

export const multibaasEnabled = () => Boolean(BASE && KEY);

async function mb(method, path, body) {
  const r = await fetch(`${BASE}/api/v0${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`MultiBaas ${method} ${path.split('?')[0]}: ${r.status} ${json.message ?? ''}`.trim());
  return json.result ?? null;
}

let contractReady = null;
const linked = new Set();

/** Register the ABI once, then link this account to it with indexing from MULTIBAAS_START. */
async function ensureLinked(account, abi) {
  const a = account.toLowerCase();
  if (linked.has(a)) return false;
  contractReady ??= (async () => {
    if (await mb('GET', `/contracts/${LABEL}`)) return;
    // bin is "optional" in the API docs, but the deployment rejects a null bytecode. Events only need the ABI.
    await mb('POST', `/contracts/${LABEL}`, { label: LABEL, contractName: 'KagiAccount', version: VERSION, rawAbi: JSON.stringify(abi), bin: '' });
  })().catch((e) => {
    contractReady = null;
    throw e;
  });
  await contractReady;

  const addr = await mb('GET', `/chains/ethereum/addresses/${a}`);
  if (addr?.contracts?.some((c) => c.label === LABEL)) {
    linked.add(a);
    return false;
  }
  if (!addr) await mb('POST', '/chains/ethereum/addresses', { address: account, alias: `kagi-${a.slice(2, 12)}` });
  await mb('POST', `/chains/ethereum/addresses/${a}/contracts`, { label: LABEL, version: VERSION, startingBlock: START });
  linked.add(a);
  return true;
}

/** Start indexing an account in the background. Never fails the tool that called it. */
export function track(account, abi) {
  if (!multibaasEnabled()) return;
  ensureLinked(account, abi).catch((e) => console.log('multibaas link failed:', e.message));
}

const field = (inputs, name) => inputs.find((i) => i.name === name)?.value;

/**
 * The account's recent events, newest first, as plain rows. `justLinked` means indexing only
 * started now: the first results may take a minute to fill in.
 */
export async function activity(account, abi, limit = 25) {
  const justLinked = await ensureLinked(account, abi);
  const q = new URLSearchParams({ contract_address: account.toLowerCase(), limit: String(limit) });
  const events = (await mb('GET', `/events?${q}`)) ?? [];
  const rows = events.map((e) => {
    const inp = e.event?.inputs ?? [];
    return {
      event: e.event?.name,
      at: e.triggeredAt,
      block: e.transaction?.blockNumber,
      tx: e.transaction?.txHash,
      agent: field(inp, 'agent'),
      to: field(inp, 'to'),
      value: field(inp, 'value'),
      cap: field(inp, 'cap'),
      oldCap: field(inp, 'oldCap'),
      newCap: field(inp, 'newCap'),
      reason: field(inp, 'reason'),
    };
  });
  rows.sort((x, y) => (y.block ?? 0) - (x.block ?? 0));
  return { justLinked, rows };
}
