import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { AGENTS, initialState, makeGrantRequest, makeSignRequest, makeTx, pick } from './mock';
import { loadShard } from '../lib/shard';
import type { Action, AgentKey, State, TxKind } from './types';

function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'HYDRATED':
      return { ...state, hydrated: true, onboarded: a.address !== null, address: a.address };
    case 'ONBOARDED':
      return { ...state, onboarded: true, address: a.address, keys: [], requests: [], signs: [] };
    case 'RESET':
      return { ...initialState, hydrated: true, wrist: state.wrist };
    case 'WRIST':
      return { ...state, wrist: { ...state.wrist, ...a.patch } };
    case 'SPEND':
      return {
        ...state,
        keys: state.keys.map((k) =>
          k.id === a.tx.keyId
            ? {
                ...k,
                txs: [a.tx, ...k.txs],
                spentUsdc: a.tx.status === 'landed' ? k.spentUsdc + a.tx.amountUsdc : k.spentUsdc,
              }
            : k,
        ),
      };
    case 'GRANT_REQUEST':
      return { ...state, requests: [a.req, ...state.requests] };
    case 'GRANT_DECIDE':
      return {
        ...state,
        requests: state.requests.map((r) => (r.id === a.id ? { ...r, status: a.status } : r)),
        keys: a.key ? [a.key, ...state.keys] : state.keys,
      };
    case 'ISSUE_KEY':
      return { ...state, keys: [a.key, ...state.keys] };
    case 'SIGN_REQUEST':
      return { ...state, signs: [a.req, ...state.signs] };
    case 'SIGN_UPDATE': {
      const req = state.signs.find((s) => s.id === a.id);
      if (!req) return state;
      const signs = state.signs.map((s) => (s.id === a.id ? { ...s, status: a.status } : s));
      if (a.status !== 'landed') return { ...state, signs };
      const tx = { ...makeTx(req.keyId, req.amountUsdc, req.kind, 'co-signed'), to: req.to, toLabel: req.toLabel };
      return {
        ...state,
        signs,
        keys: state.keys.map((k) => (k.id === req.keyId ? { ...k, txs: [tx, ...k.txs] } : k)),
      };
    }
    case 'REVOKE_KEY':
      return { ...state, keys: state.keys.map((k) => (k.id === a.id ? { ...k, status: 'revoked' } : k)) };
    case 'REVOKE_ALL':
      return {
        ...state,
        autopilot: false,
        keys: state.keys.map((k) => (k.status === 'live' ? { ...k, status: 'revoked' } : k)),
        signs: state.signs.map((s) => (s.status === 'pending' || s.status === 'phone-signed' ? { ...s, status: 'rejected' } : s)),
      };
    case 'EXPIRE_SOONEST': {
      const live = state.keys.filter((k) => k.status === 'live').sort((x, y) => x.expiresAt - y.expiresAt);
      const soonest = live[0];
      if (!soonest) return state;
      return {
        ...state,
        keys: state.keys.map((k) => (k.id === soonest.id ? { ...k, status: 'expired', expiresAt: Date.now() } : k)),
      };
    }
    case 'AUTOPILOT':
      return { ...state, autopilot: a.on };
    case 'TICK':
      if (!state.keys.some((k) => k.status === 'live' && k.expiresAt <= a.now)) return state;
      return {
        ...state,
        keys: state.keys.map((k) => (k.status === 'live' && k.expiresAt <= a.now ? { ...k, status: 'expired' } : k)),
      };
    default:
      return state;
  }
}

/** Stand-ins for the agent, the chain and the Kagi Wallet. Swap for real transport later. */
export interface Sim {
  requestKey: (agent?: string, capUsdc?: number, durationH?: number) => string;
  /** Agent spends under its cap. Returns null when no key can absorb it. */
  spend: (amountUsdc?: number) => string | null;
  /** Agent tries something over the cap: on-chain reject, then escalation to the manager key. */
  overCap: () => string | null;
  expireSoonest: () => void;
  autopilot: (on: boolean) => void;
  reset: () => void;
}

interface Ctx {
  state: State;
  dispatch: React.Dispatch<Action>;
  sim: Sim;
}

const StoreCtx = createContext<Ctx | null>(null);

const round2 = (n: number) => Math.round(n * 100) / 100;

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const ref = useRef(state);
  useEffect(() => {
    ref.current = state;
  }, [state]);

  useEffect(() => {
    void loadShard().then((s) => dispatch({ type: 'HYDRATED', address: s?.groupKey ?? null }));
  }, []);

  useEffect(() => {
    const t = setInterval(() => dispatch({ type: 'TICK', now: Date.now() }), 15000);
    return () => clearInterval(t);
  }, []);

  const sim = useMemo<Sim>(() => {
    const liveKeys = () => ref.current.keys.filter((k) => k.status === 'live');
    const spendWith = (key: AgentKey, amount: number, escalate: boolean): string | null => {
      // The Kagi Wallet decodes transfer and approve calldata, so the agent sticks to those.
      const kind = pick<TxKind>(['transfer', 'transfer', 'approve']);
      if (key.spentUsdc + amount > key.capUsdc) {
        if (!escalate) return null;
        dispatch({ type: 'SPEND', tx: makeTx(key.id, amount, kind, 'rejected') });
        const req = makeSignRequest(key, amount, kind);
        dispatch({ type: 'SIGN_REQUEST', req });
        return req.id;
      }
      const tx = makeTx(key.id, amount, kind, 'landed');
      dispatch({ type: 'SPEND', tx });
      return tx.id;
    };
    return {
      requestKey: (agent, capUsdc = 500, durationH = 24) => {
        const taken = new Set(liveKeys().map((k) => k.agent));
        const name = agent ?? AGENTS.find((a) => !taken.has(a)) ?? pick(AGENTS);
        const req = makeGrantRequest(name, capUsdc, durationH);
        dispatch({ type: 'GRANT_REQUEST', req });
        return req.id;
      },
      spend: (amount) => {
        const live = liveKeys();
        if (!live.length) return null;
        const key = pick(live);
        const amt = amount ?? round2(5 + Math.random() * 40);
        return spendWith(key, amt, amount !== undefined);
      },
      overCap: () => {
        const live = liveKeys();
        if (!live.length) return null;
        const key = live.reduce((a, b) => (a.capUsdc - a.spentUsdc < b.capUsdc - b.spentUsdc ? a : b));
        const headroom = key.capUsdc - key.spentUsdc;
        const amt = round2(Math.max(headroom + 100, key.capUsdc * 0.6));
        return spendWith(key, amt, true);
      },
      expireSoonest: () => dispatch({ type: 'EXPIRE_SOONEST' }),
      autopilot: (on) => dispatch({ type: 'AUTOPILOT', on }),
      reset: () => dispatch({ type: 'RESET' }),
    };
  }, []);

  useEffect(() => {
    if (!state.autopilot) return;
    const t = setInterval(() => sim.spend(), 4000);
    return () => clearInterval(t);
  }, [state.autopilot, sim]);

  const value = useMemo(() => ({ state, dispatch, sim }), [state, sim]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): Ctx {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore outside StoreProvider');
  return ctx;
}

export function useExposure() {
  const { state } = useStore();
  return useMemo(() => {
    const live = state.keys.filter((k) => k.status === 'live');
    const cap = live.reduce((s, k) => s + k.capUsdc, 0);
    const spent = live.reduce((s, k) => s + k.spentUsdc, 0);
    return { live, cap, spent, ratio: cap > 0 ? spent / cap : 0 };
  }, [state.keys]);
}
