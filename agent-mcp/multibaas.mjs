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

// ---- Event Queries: spending summaries -----------------------------------------------------
// MultiBaas aggregates indexed events server side (group by a field, add up another), so a
// summary is a handful of small queries instead of scanning logs. Events are named by their
// signature; inputs by index, in the order the contract declares them.

const EV = {
  granted: { sig: 'Granted(address,uint256,uint256)', agent: 0, cap: 1, expiry: 2 },
  spent: { sig: 'Spent(address,address,uint256)', agent: 0, to: 1, value: 2 },
  requested: { sig: 'LimitRequested(address,uint256,uint256,string)', agent: 0, oldCap: 1, newCap: 2, reason: 3 },
  raised: { sig: 'LimitRaised(address,uint256,uint256)', agent: 0, oldCap: 1, newCap: 2 },
  declined: { sig: 'LimitDeclined(address,uint256)', agent: 0, newCap: 1 },
  revoked: { sig: 'Revoked(address)', agent: 0 },
};

const sel = (i, alias, aggregator) => ({ type: 'input', inputIndex: i, alias, ...(aggregator ? { aggregator } : {}) });
const onAccount = (account) => ({ rule: 'and', children: [{ fieldType: 'contract_address', operator: 'equal', value: account.toLowerCase() }] });
const onKagi = () => ({ rule: 'and', children: [{ fieldType: 'contract_label', operator: 'equal', value: LABEL }] });

async function run(query) {
  return (await mb('POST', '/queries', query))?.rows ?? [];
}

/**
 * One wallet's spending and approvals, from MultiBaas Event Queries: totals per agent and per
 * recipient (aggregated by MultiBaas), and the requests, raises, declines and Intercepta holds.
 */
export async function spendingSummary(account, abi) {
  await ensureLinked(account, abi);
  const where = onAccount(account);
  const [byAgent, byRecipient, payments, grants, raises, raiseEvents, requests, declines, revokes] = await Promise.all([
    run({ events: [{ eventName: EV.spent.sig, select: [sel(EV.spent.agent, 'agent'), sel(EV.spent.value, 'total', 'add')], filter: where }], groupBy: 'agent', orderBy: 'total', order: 'DESC' }),
    run({ events: [{ eventName: EV.spent.sig, select: [sel(EV.spent.to, 'to'), sel(EV.spent.value, 'total', 'add')], filter: where }], groupBy: 'to', orderBy: 'total', order: 'DESC' }),
    run({ events: [{ eventName: EV.spent.sig, select: [sel(EV.spent.agent, 'agent')], filter: where }] }),
    run({ events: [{ eventName: EV.granted.sig, select: [sel(EV.granted.agent, 'agent'), sel(EV.granted.cap, 'cap', 'last')], filter: where }], groupBy: 'agent' }),
    run({ events: [{ eventName: EV.raised.sig, select: [sel(EV.raised.agent, 'agent'), sel(EV.raised.newCap, 'cap', 'max')], filter: where }], groupBy: 'agent' }),
    run({ events: [{ eventName: EV.raised.sig, select: [sel(EV.raised.agent, 'agent')], filter: where }] }),
    run({ events: [{ eventName: EV.requested.sig, select: [sel(EV.requested.agent, 'agent'), sel(EV.requested.newCap, 'newCap'), sel(EV.requested.reason, 'reason')], filter: where }] }),
    run({ events: [{ eventName: EV.declined.sig, select: [sel(EV.declined.agent, 'agent')], filter: where }] }),
    run({ events: [{ eventName: EV.revoked.sig, select: [sel(EV.revoked.agent, 'agent')], filter: where }] }),
  ]);
  const low = (a) => String(a ?? '').toLowerCase();
  const count = (rows, agent) => rows.filter((r) => low(r.agent) === agent).length;
  const agents = [...new Set([...grants, ...byAgent].map((r) => low(r.agent)))];
  return {
    agents: agents.map((a) => ({
      agent: a,
      spent: BigInt(byAgent.find((r) => low(r.agent) === a)?.total ?? 0),
      payments: count(payments, a),
      grantedCap: grants.find((r) => low(r.agent) === a)?.cap ?? null,
      raisedTo: raises.find((r) => low(r.agent) === a)?.cap ?? null,
      revoked: count(revokes, a) > 0,
    })),
    recipients: byRecipient.map((r) => ({ to: r.to, total: BigInt(r.total ?? 0) })),
    approvals: {
      requested: requests.length,
      approved: raiseEvents.length,
      declined: declines.length,
      held: requests.filter((r) => String(r.reason ?? '').startsWith('Intercepta held')).length,
      blocked: requests.filter((r) => String(r.reason ?? '').startsWith('Intercepta blocked')).length,
    },
  };
}

// ---- Saved queries: the protocol dashboard ------------------------------------------------
// The same questions across every Kagi wallet, saved in the MultiBaas console under Event
// Queries, so an operator can watch the protocol without writing any code.
export const DASHBOARD = {
  'kagi-spent-by-agent': { events: [{ eventName: EV.spent.sig, select: [sel(EV.spent.agent, 'agent'), sel(EV.spent.value, 'total_wei', 'add')], filter: onKagi() }], groupBy: 'agent', orderBy: 'total_wei', order: 'DESC' },
  'kagi-spent-by-recipient': { events: [{ eventName: EV.spent.sig, select: [sel(EV.spent.to, 'recipient'), sel(EV.spent.value, 'total_wei', 'add')], filter: onKagi() }], groupBy: 'recipient', orderBy: 'total_wei', order: 'DESC' },
  'kagi-limit-raises': { events: [{ eventName: EV.raised.sig, select: [sel(EV.raised.agent, 'agent'), sel(EV.raised.newCap, 'highest_cap_wei', 'max')], filter: onKagi() }], groupBy: 'agent' },
  'kagi-limit-requests': { events: [{ eventName: EV.requested.sig, select: [sel(EV.requested.agent, 'agent'), sel(EV.requested.newCap, 'requested_cap_wei'), sel(EV.requested.reason, 'reason')], filter: onKagi() }] },
};

/** Create or update the dashboard's saved queries. Returns their labels. */
export async function saveDashboard() {
  for (const [label, query] of Object.entries(DASHBOARD)) await mb('PUT', `/queries/${label}`, query);
  return Object.keys(DASHBOARD);
}

/** A saved query's current results. */
export async function dashboardResults(label) {
  return (await mb('GET', `/queries/${label}/results`))?.rows ?? [];
}
