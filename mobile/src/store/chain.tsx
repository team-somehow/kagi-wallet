import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { router, useRootNavigationState } from 'expo-router';
import * as bg from '../../modules/kagi-background';
import { formatEther, formatUnits } from 'viem';
import { link } from '../lib/link';
import { buzz } from '../lib/haptics';
import * as evm from '../lib/evm';
import { listSessionAddresses, loadSessionKey } from '../lib/session';
import { useStore } from './store';

/** The chain, read by the phone itself: the account, agent keys, what they did, and what they ask. */
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
  block: bigint;
  account: string | null;
  balance: bigint;
  nonce: bigint;
  gasAddress: string;
  gasBalance: bigint;
  explorer: string;
  sessions: ChainSession[];
  /** When this was read, for turning block heights into rough times. */
  readAt: number;
}

export type LimitStatus = 'waiting' | 'submitting' | 'confirmed' | 'rejected' | 'failed' | 'expired';

export interface LimitRequest {
  id: string; // the request's transaction hash
  agent: string;
  name: string;
  account: string;
  oldCap: bigint;
  newCap: bigint;
  spent: bigint;
  expiry: bigint;
  reason: string;
  status: LimitStatus;
  hash: string | null; // the raise or decline transaction
  error: string | null;
  block: bigint;
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
  error: string | null;
  refresh: () => Promise<ChainInfo | null>;
  activity: Activity[];
  limits: Record<string, LimitRequest>;
  /** The limit screen reports what it is doing, until the chain catches up. */
  setLimitLocal: (id: string, patch: Partial<Pick<LimitRequest, 'status' | 'hash' | 'error'>>) => void;
  sessions: ChainSession[];
  live: ChainSession[];
  totals: { left: bigint; cap: bigint; spent: bigint };
}

const ChainCtx = createContext<Ctx | null>(null);
export const fmtEth = (wei: bigint) => `${formatEther(wei)} ETH`;
export const fmtAmount = (wei: bigint) => wei < 10n ** 16n ? `${formatUnits(wei, 12)} µETH` : fmtEth(wei);

/**
 * The agent server screens every recipient with Intercepta. A flagged payment arrives as a
 * limit request whose reason starts with one of these, so the owner can approve or bypass it.
 */
export function interceptaFlag(reason: string): 'held' | 'blocked' | null {
  if (reason.startsWith('Intercepta blocked:')) return 'blocked';
  if (reason.startsWith('Intercepta held:')) return 'held';
  return null;
}

// A stable notification id per request, from its transaction hash.
const alertId = (hash: string) => parseInt(hash.slice(2, 9), 16);

// A request nobody answered lapses after about ten minutes of blocks; the old limit stands.
const REQUEST_BLOCKS = 50n;
// On start, look back about three hours for requests and activity.
const BACKLOG_BLOCKS = 900n;

export function ChainProvider({ children }: { children: React.ReactNode }) {
  const { state } = useStore();
  const groupKey = state.address;
  const [info, setInfo] = useState<ChainInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [evs, setEvs] = useState<evm.AccountEvent[]>([]);
  const [local, setLocal] = useState<Record<string, Partial<LimitRequest>>>({});
  const navReady = Boolean(useRootNavigationState()?.key);
  const navRef = useRef(navReady);
  const opened = useRef(new Set<string>());
  const scanned = useRef<{ account: string; to: bigint } | null>(null);
  const infoRef = useRef<ChainInfo | null>(null);
  useEffect(() => {
    navRef.current = navReady;
  }, [navReady]);

  const refresh = useCallback(async () => {
    if (!groupKey) return null;
    try {
      const o = await evm.overview(groupKey);
      const sessions: ChainSession[] = [];
      if (o.account) {
        const account = o.account;
        for (const addr of await listSessionAddresses()) {
          const k = await loadSessionKey(addr);
          const s = await evm.session(account, addr as `0x${string}`);
          // Keys made for an earlier wallet have no session on this account.
          if (s.cap === 0n && s.expiry === 0n) continue;
          const status: ChainSession['status'] = s.expiry === 0n ? 'revoked' : s.expiry <= o.now ? 'expired' : 'active';
          sessions.push({ address: k?.address ?? addr, name: k?.name ?? 'agent', ...s, status, local: Boolean(k) });
        }
      }
      const i: ChainInfo = { ...o, account: o.account, sessions, readAt: Date.now() };
      infoRef.current = i;
      setInfo(i);
      setError(null);

      // New events since the last look.
      if (o.account) {
        const from = scanned.current?.account === o.account ? scanned.current.to + 1n : o.block > BACKLOG_BLOCKS ? o.block - BACKLOG_BLOCKS : 0n;
        if (from <= o.block) {
          const fresh = await evm.events(o.account as `0x${string}`, from, o.block);
          scanned.current = { account: o.account, to: o.block };
          if (fresh.length) setEvs((xs) => [...xs, ...fresh]);
        }
      }
      return i;
    } catch (e) {
      setError(evm.reason(e));
      return null;
    }
  }, [groupKey]);

  // A new wallet starts from nothing.
  useEffect(() => {
    scanned.current = null;
    const t = setTimeout(() => {
      setEvs([]);
      setInfo(null);
    }, 0);
    return () => clearTimeout(t);
  }, [groupKey]);

  // Keep the chain view fresh while the wallet exists: about one block.
  useEffect(() => {
    if (!groupKey) return;
    const first = setTimeout(() => void refresh(), 0);
    const t = setInterval(() => void refresh(), 8000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [groupKey, refresh]);

  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of info?.sessions ?? []) m[s.address.toLowerCase()] = s.name;
    return m;
  }, [info]);
  const nameOf = useCallback((a: string) => names[a.toLowerCase()] ?? `agent ${a.slice(2, 6)}`, [names]);

  // Limit requests, answered from the events that follow them.
  const limits = useMemo(() => {
    const out: Record<string, LimitRequest> = {};
    if (!info?.account) return out;
    for (const e of evs) {
      if (e.kind !== 'requested') continue;
      const after = evs.filter((x) => x.block >= e.block && x.agent.toLowerCase() === e.agent.toLowerCase());
      const raised = after.find((x) => x.kind === 'raised' && x.newCap >= e.newCap);
      const declined = after.find((x) => x.kind === 'declined' && x.newCap === e.newCap);
      const s = info.sessions.find((x) => x.address.toLowerCase() === e.agent.toLowerCase());
      let status: LimitStatus = 'waiting';
      let hash: string | null = null;
      if (raised && raised.kind === 'raised') [status, hash] = ['confirmed', raised.hash];
      else if (declined) [status, hash] = ['rejected', declined.hash];
      else if (s && s.cap >= e.newCap) status = 'confirmed';
      else if (!s || s.status !== 'active') status = 'expired';
      else if (info.block - e.block > REQUEST_BLOCKS) status = 'expired';
      const l = local[e.hash];
      // What the phone is doing wins until the chain shows an answer.
      if (l && (status === 'waiting' || status === 'expired') && l.status) status = l.status;
      out[e.hash] = {
        id: e.hash,
        agent: e.agent,
        name: nameOf(e.agent),
        account: info.account,
        oldCap: e.oldCap,
        newCap: e.newCap,
        spent: s?.spent ?? 0n,
        expiry: s?.expiry ?? 0n,
        reason: e.reason,
        status,
        hash: hash ?? (l?.hash as string | undefined) ?? null,
        error: (l?.error as string | undefined) ?? null,
        block: e.block,
      };
    }
    return out;
  }, [evs, info, local, nameOf]);

  const setLimitLocal = useCallback((id: string, patch: Partial<Pick<LimitRequest, 'status' | 'hash' | 'error'>>) => {
    setLocal((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  }, []);

  // A new request the owner hasn't seen: in the app, bring the approval screen up; in another
  // app, a heads-up notification that opens it. The fingerprint needs the app in front.
  useEffect(() => {
    for (const r of Object.values(limits)) {
      const nid = alertId(r.id);
      if (r.status !== 'waiting') {
        bg.clearAlert(nid);
        continue;
      }
      if (opened.current.has(r.id)) continue;
      opened.current.add(r.id);
      void buzz();
      // The Kagi Wallet is with the owner even when the phone is in a pocket: buzz it too.
      const flag = interceptaFlag(r.reason);
      link.send({
        t: 'alert',
        level: flag ? 'red' : 'amber',
        text: flag === 'blocked' ? 'Intercepta blocked' : flag === 'held' ? 'Intercepta held' : 'Limit request',
      });
      if (AppState.currentState === 'active' && navRef.current) {
        router.push(`/limit/${r.id}`);
      } else if (flag) {
        bg.alert(nid, `Intercepta ${flag} a payment by ${r.name}`, `${r.reason.replace(/^Intercepta (held|blocked): /, '')} Tap to decline, or bypass with all your devices.`, `kagi://limit/${r.id}`);
      } else {
        bg.alert(nid, `${r.name} asks for a higher limit`, `Raise its total from ${fmtEth(r.oldCap)} to ${fmtEth(r.newCap)}. Tap to approve with your fingerprint and your stick.`, `kagi://limit/${r.id}`);
      }
    }
  }, [limits]);

  // What agents did, newest first. Times are estimated from block height (about 12 s a block).
  const activity = useMemo(() => {
    if (!info) return [];
    const at = (b: bigint) => info.readAt - Number(info.block - b) * 12_000;
    const out: Activity[] = [];
    for (const e of evs) {
      const name = nameOf(e.agent);
      const base = { name, agent: e.agent, hash: e.hash, at: at(e.block) };
      if (e.kind === 'spent') out.push({ ...base, key: `spent-${e.hash}`, kind: 'transfer', status: 'confirmed', to: e.to, value: e.value, text: `Sent ${fmtEth(e.value)}` });
      else if (e.kind === 'raised') out.push({ ...base, key: `raised-${e.hash}`, kind: 'limit', status: 'confirmed', text: `Limit raised to ${fmtEth(e.newCap)}` });
      else if (e.kind === 'declined') out.push({ ...base, key: `declined-${e.hash}`, kind: 'limit', status: 'rejected', text: `Declined a limit of ${fmtEth(e.newCap)}` });
      else if (e.kind === 'requested') out.push({ ...base, key: `requested-${e.hash}`, kind: 'limit', status: 'requested', text: `Asked for ${fmtEth(e.newCap)} in total` });
      else if (e.kind === 'granted') out.push({ ...base, key: `granted-${e.hash}`, kind: 'grant', status: 'confirmed', text: `Key granted, ${fmtEth(e.cap)} allowance` });
      else if (e.kind === 'revoked') out.push({ ...base, key: `revoked-${e.hash}`, kind: 'grant', status: 'revoked', text: 'Key revoked' });
    }
    return out.reverse().slice(0, 40);
  }, [evs, info, nameOf]);

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

  // The Kagi Wallet's allowance ring shows every live key together, in ETH.
  const { wrist } = state;
  useEffect(() => {
    if (!wrist.connected || !groupKey) return;
    const cap = Number(totals.cap) / 1e18;
    const spent = Number(totals.spent) / 1e18;
    link.send({ t: 'exposure', unit: 'ETH', left: Math.max(cap - spent, 0), cap, spent, keys: live.length });
  }, [totals, live.length, wrist.connected, groupKey]);

  const value = useMemo(
    () => ({ info, error, refresh, activity, limits, setLimitLocal, sessions, live, totals }),
    [info, error, refresh, activity, limits, setLimitLocal, sessions, live, totals],
  );
  return <ChainCtx.Provider value={value}>{children}</ChainCtx.Provider>;
}

export function useChain(): Ctx {
  const c = useContext(ChainCtx);
  if (!c) throw new Error('useChain outside ChainProvider');
  return c;
}
