// Limit requests: an agent asks for a higher total allowance, the phone and stick decide,
// the hub confirms the new cap on-chain before anyone is told it went through.
//
// States: waiting -> (rejected | submitting -> (confirmed | failed)) and waiting -> expired.
// "Approved" is never a final state here: only a confirmed receipt counts.
import { randomUUID } from 'node:crypto';
import * as evm from './evm.mjs';

const reqs = new Map(); // id -> request
const waiters = new Map(); // id -> Set(resolve)
let notify = () => undefined; // set by the hub: pushes updates to phones

export function onUpdate(fn) {
  notify = fn;
}

const FINAL = new Set(['confirmed', 'rejected', 'failed', 'expired']);
const view = (r) => ({
  t: 'limit_request',
  src: 'hub',
  id: r.id,
  agent: r.agent,
  name: r.name,
  account: r.account,
  groupKey: r.gk,
  oldCap: r.oldCap.toString(),
  newCap: r.newCap.toString(),
  spent: r.spent.toString(),
  expiry: r.expiry.toString(),
  reason: r.reason,
  transfer: r.transfer,
  status: r.status,
  hash: r.hash ?? null,
  error: r.error ?? null,
  at: r.at,
});

function set(r, patch) {
  Object.assign(r, patch);
  notify(view(r));
  if (FINAL.has(r.status)) {
    for (const w of waiters.get(r.id) ?? []) w(view(r));
    waiters.delete(r.id);
  }
}

/** Open a request. A second request for the same key while one is waiting returns the first. */
export async function create({ agent, newCap, reason, transfer }) {
  const who = evm.findAgent(agent);
  if (!who) throw new Error('This session key is not registered with any Leash wallet.');
  for (const r of reqs.values()) if (r.agent.toLowerCase() === agent.toLowerCase() && r.status === 'waiting') return view(r);
  const s = await evm.sessionOf(who.account, who.address);
  if (s.status !== 'active') throw new Error(`The session is ${s.status}; it cannot be raised.`);
  const cap = BigInt(newCap);
  if (cap <= s.cap) throw new Error('The new limit must be higher than the current one.');
  const r = {
    id: randomUUID().slice(0, 8),
    agent: who.address,
    name: who.name,
    account: who.account,
    gk: who.gk,
    oldCap: s.cap,
    newCap: cap,
    spent: s.spent,
    expiry: s.expiry,
    reason: String(reason ?? '').slice(0, 200),
    transfer: transfer ?? null,
    status: 'waiting',
    at: Date.now(),
  };
  reqs.set(r.id, r);
  notify(view(r));
  // Nobody answers within 5 minutes: it lapses, and the old limit stands.
  setTimeout(() => r.status === 'waiting' && set(r, { status: 'expired' }), 5 * 60_000);
  return view(r);
}

export function get(id) {
  const r = reqs.get(id);
  return r ? view(r) : null;
}

export function pending() {
  return [...reqs.values()].filter((r) => !FINAL.has(r.status)).map(view);
}

/** Wait for a final state, or give back the current one after timeoutMs. */
export function wait(id, timeoutMs) {
  const r = reqs.get(id);
  if (!r) return Promise.resolve(null);
  if (FINAL.has(r.status)) return Promise.resolve(view(r));
  return new Promise((resolve) => {
    const set_ = waiters.get(id) ?? new Set();
    const done = (v) => {
      clearTimeout(t);
      resolve(v);
    };
    set_.add(done);
    waiters.set(id, set_);
    const t = setTimeout(() => {
      set_.delete(done);
      resolve(view(r));
    }, timeoutMs);
  });
}

/** The phone's answer: a manager signature over the raise, or a decline. */
export async function decide(id, { approved, sig }) {
  const r = reqs.get(id);
  if (!r) throw new Error('No such request.');
  if (r.status !== 'waiting') return view(r);
  if (!approved) {
    set(r, { status: 'rejected' });
    return view(r);
  }
  set(r, { status: 'submitting' });
  try {
    const res = await evm.raiseLimit(r.account, {
      agent: r.agent,
      oldCap: r.oldCap.toString(),
      newCap: r.newCap.toString(),
      expiry: r.expiry.toString(),
      sig,
    });
    if (res.status !== 'success') set(r, { status: 'failed', hash: res.hash, error: 'The raise reverted on-chain.' });
    else set(r, { status: 'confirmed', hash: res.hash });
  } catch (e) {
    set(r, { status: 'failed', error: e?.message ?? String(e) });
  }
  return view(r);
}
