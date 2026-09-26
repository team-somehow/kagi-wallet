import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { link, type Msg } from '../lib/link';
import { buzz } from '../lib/haptics';
import { listSessionAddresses } from '../lib/session';
import { useStore } from './store';

/** The real Sepolia side, through the hub: account, agent sessions, activity, limit requests. */
export interface ChainSession {
  address: string;
  name: string;
  cap: bigint;
  spent: bigint;
  expiry: bigint;
  nonce: bigint;
  status: 'active' | 'expired' | 'revoked';
  local: boolean; // the phone holds this key and can copy it
}

export interface ChainInfo {
  chainId: number;
  now: bigint;
  account: string | null;
  balance: bigint;
  nonce: bigint;
  relayerBalance: bigint;
  explorer: string;
  sessions: ChainSession[];
}

export interface LimitRequest {
  id: string;
  agent: string;
  name: string;
  account: string;
  oldCap: bigint;
  newCap: bigint;
  spent: bigint;
  expiry: bigint;
  reason: string;
  transfer: { to: string; value: string } | null;
  status: 'waiting' | 'submitting' | 'confirmed' | 'rejected' | 'failed' | 'expired';
  hash: string | null;
  error: string | null;
  at: number;
}

export interface Activity {
  key: string;
  kind: 'transfer' | 'limit' | 'grant' | 'account';
  status: string;
  name: string;
  agent?: string;
  to?: string;
  value?: bigint;
  hash?: string | null;
  text: string;
  at: number;
}

interface Ctx {
  info: ChainInfo | null;
  hubUp: boolean;
  error: string | null;
  refresh: () => Promise<ChainInfo | null>;
  activity: Activity[];
  addActivity: (a: Activity) => void;
  limits: Record<string, LimitRequest>;
  /** Every key this wallet ever granted, live ones first, newest first. */
  sessions: ChainSession[];
  live: ChainSession[];
  /** Live allowance left, summed over every live key. */
  totals: { left: bigint; cap: bigint; spent: bigint };
}

const ChainCtx = createContext<Ctx | null>(null);
const fmtEth = (wei: bigint) => {
  const s = (Number(wei) / 1e18).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return `${s} ETH`;
};
export { fmtEth };

function parseInfo(m: Msg, local: string[]): ChainInfo {
  const now = BigInt(String(m.now ?? '0'));
  const sessions = ((m.sessions as Record<string, string>[]) ?? []).map((x) => {
    const expiry = BigInt(x.expiry);
    const cap = BigInt(x.cap);
    return {
      address: x.address,
      name: x.name,
      cap,
      spent: BigInt(x.spent),
      expiry,
      nonce: BigInt(x.nonce),
      status: (expiry === 0n && cap > 0n ? 'revoked' : expiry <= now ? 'expired' : 'active') as ChainSession['status'],
      local: local.includes(x.address.toLowerCase()),
    };
  });
  return {
    chainId: Number(m.chainId),
    now,
    account: (m.account as string) ?? null,
    balance: BigInt(String(m.accountBalance ?? '0')),
    nonce: BigInt(String(m.nonce ?? '0')),
    relayerBalance: BigInt(String(m.relayerBalance ?? '0')),
    explorer: String(m.explorer ?? 'https://sepolia.etherscan.io'),
    sessions,
  };
}

function parseLimit(m: Msg): LimitRequest {
  return {
    id: String(m.id),
    agent: String(m.agent),
    name: String(m.name),
    account: String(m.account),
    oldCap: BigInt(String(m.oldCap)),
    newCap: BigInt(String(m.newCap)),
    spent: BigInt(String(m.spent)),
    expiry: BigInt(String(m.expiry)),
    reason: String(m.reason ?? ''),
    transfer: (m.transfer as LimitRequest['transfer']) ?? null,
    status: m.status as LimitRequest['status'],
    hash: (m.hash as string) ?? null,
    error: (m.error as string) ?? null,
    at: Number(m.at ?? Date.now()),
  };
}

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const groupKey = state.address;
  const [info, setInfo] = useState<ChainInfo | null>(null);
  const [hubUp, setHubUp] = useState(link.open);
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [limits, setLimits] = useState<Record<string, LimitRequest>>({});
  const navReady = Boolean(useRootNavigationState()?.key);
  const navRef = useRef(navReady);
  const opened = useRef(new Set<string>());
  const gkRef = useRef(groupKey);
  useEffect(() => {
    navRef.current = navReady;
    gkRef.current = groupKey;
  }, [navReady, groupKey]);

  const addActivity = useCallback((a: Activity) => {
    setActivity((xs) => [a, ...xs.filter((x) => x.key !== a.key)].slice(0, 30));
  }, []);

  const refresh = useCallback(async () => {
    const gk = gkRef.current;
    if (!gk) return null;
    try {
      const [m, local] = await Promise.all([link.request<Msg>({ t: 'evm_info?', groupKey: gk }, 20000), listSessionAddresses()]);
      if (m.t === 'evm_error') throw new Error(String(m.reason));
      const i = parseInfo(m, local);
      setInfo(i);
      setError(null);
      return i;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the hub.');
      return null;
    }
  }, []);

  useEffect(() => {
    const offState = link.onState((open) => {
      setHubUp(open);
      if (open) {
        link.send({ t: 'limit_pending?' });
        void refresh();
      }
    });
    const off = link.on((m) => {
      if (m.t === 'limit_request') {
        const r = parseLimit(m);
        setLimits((ls) => ({ ...ls, [r.id]: r }));
        if (r.status === 'waiting' && !opened.current.has(r.id)) {
          opened.current.add(r.id);
          void buzz();
          if (navRef.current) router.push(`/limit/${r.id}`);
        }
        if (r.status === 'confirmed' || r.status === 'rejected') {
          addActivity({
            key: `limit-${r.id}-${r.status}`,
            kind: 'limit',
            status: r.status,
            name: r.name,
            agent: r.agent,
            hash: r.hash,
            text: r.status === 'confirmed' ? `Limit raised to ${fmtEth(r.newCap)}` : `Declined a limit of ${fmtEth(r.newCap)}`,
            at: Date.now(),
          });
          void refresh();
        }
      } else if (m.t === 'agent_activity' && m.kind === 'transfer') {
        const value = BigInt(String(m.value ?? '0'));
        addActivity({
          key: `tx-${String(m.hash ?? m.at)}-${String(m.status)}`,
          kind: 'transfer',
          status: String(m.status),
          name: String(m.name),
          agent: String(m.agent ?? ''),
          to: String(m.to),
          value,
          hash: (m.hash as string) ?? null,
          text: m.status === 'confirmed' ? `Sent ${fmtEth(value)}` : m.status === 'failed' ? `Transfer of ${fmtEth(value)} failed` : `Sending ${fmtEth(value)}…`,
          at: Number(m.at ?? Date.now()),
        });
        if (m.status !== 'submitted') void refresh();
      }
    });
    return () => {
      off();
      offState();
    };
  }, [refresh, addActivity]);

  // Keep the chain view fresh while the wallet exists.
  useEffect(() => {
    if (!groupKey) return;
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 10000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [groupKey, refresh]);

  const sessions = useMemo(() => {
    const order = { active: 0, expired: 1, revoked: 2 } as const;
    return [...(info?.sessions ?? [])].reverse().sort((a, b) => order[a.status] - order[b.status]);
  }, [info]);
  const live = useMemo(() => sessions.filter((x) => x.status === 'active'), [sessions]);
  const totals = useMemo(() => {
    let cap = 0n;
    let spent = 0n;
    for (const x of live) {
      cap += x.cap;
      spent += x.spent < x.cap ? x.spent : x.cap;
    }
    return { cap, spent, left: cap - spent };
  }, [live]);

  // The wrist's allowance ring shows every live key together, in ETH.
  const { wrist } = state;
  useEffect(() => {
    if (!wrist.connected || !groupKey) return;
    const cap = Number(totals.cap) / 1e18;
    const spent = Number(totals.spent) / 1e18;
    link.send({ t: 'exposure', unit: 'ETH', left: Math.max(cap - spent, 0), cap, spent, keys: live.length });
  }, [totals, live.length, wrist.connected, groupKey]);

  const value = useMemo(
    () => ({ info, hubUp, error, refresh, activity, addActivity, limits, sessions, live, totals }),
    [info, hubUp, error, refresh, activity, addActivity, limits, sessions, live, totals],
  );
  return <ChainCtx.Provider value={value}>{children}</ChainCtx.Provider>;
}

export function useChain(): Ctx {
  const c = useContext(ChainCtx);
  if (!c) throw new Error('useChain outside ChainProvider');
  return c;
}
