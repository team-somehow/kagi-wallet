import type { AgentKey, GrantRequest, SignRequest, State, Tx, TxKind } from './types';

const HEX = '0123456789abcdef';
export const randHex = (n: number) =>
  Array.from({ length: n }, () => HEX[Math.floor(Math.random() * 16)]).join('');
export const makeAddress = () => `0x${randHex(40)}`;
export const makePubkey = () => `0x02${randHex(64)}`;
export const uid = () => randHex(8);
export const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

export const AGENTS = ['trader', 'payroll', 'researcher'] as const;

export const DESTINATIONS = [
  { to: '0x66a9893cc07d91d95644aedd05d03f95e1dba8af', label: 'Uniswap v4 router' },
  { to: '0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2', label: 'Aave v3 pool' },
  { to: '0x8f3c1b6e2f4a7d9c0b5e6a1d2c3b4a5f6e7d8c9a', label: 'Coinbase deposit' },
  { to: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984', label: 'alice.eth' },
] as const;

const SELECTORS: Record<TxKind, string> = {
  transfer: 'a9059cbb',
  swap: '3593564c',
  approve: '095ea7b3',
  call: '00000000',
};

export function encodeCalldata(kind: TxKind, to: string, amountUsdc: number): string {
  const units = BigInt(Math.round(amountUsdc * 1_000_000)).toString(16).padStart(64, '0');
  const addr = to.slice(2).padStart(64, '0');
  return `0x${SELECTORS[kind]}${addr}${units}`;
}

export function describe(kind: TxKind, label: string, amountUsdc: number): string {
  const amt = amountUsdc.toLocaleString('en-US', { maximumFractionDigits: 2 });
  switch (kind) {
    case 'transfer':
      return `Send ${amt} USDC to ${label}`;
    case 'swap':
      return `Swap ${amt} USDC for ETH on ${label}`;
    case 'approve':
      return `Allow ${label} to pull ${amt} USDC`;
    default:
      return `Call ${label} moving ${amt} USDC`;
  }
}

export function makeKey(agent: string, capUsdc: number, durationH: number, pubkey = makePubkey()): AgentKey {
  const now = Date.now();
  return {
    id: uid(),
    agent,
    pubkey,
    capUsdc,
    spentUsdc: 0,
    issuedAt: now,
    expiresAt: now + durationH * 3600_000,
    status: 'live',
    txs: [],
  };
}

export function makeTx(keyId: string, amountUsdc: number, kind: TxKind, status: Tx['status']): Tx {
  const d = pick(DESTINATIONS);
  return { id: uid(), keyId, at: Date.now(), amountUsdc, to: d.to, toLabel: d.label, kind, status };
}

export function makeGrantRequest(agent: string, capUsdc: number, durationH: number): GrantRequest {
  return { id: uid(), agent, pubkey: makePubkey(), capUsdc, durationH, at: Date.now(), status: 'pending' };
}

export function makeSignRequest(key: AgentKey, amountUsdc: number, kind: TxKind): SignRequest {
  const d = pick(DESTINATIONS);
  return {
    id: uid(),
    keyId: key.id,
    agent: key.agent,
    amountUsdc,
    to: d.to,
    toLabel: d.label,
    kind,
    calldata: encodeCalldata(kind, d.to, amountUsdc),
    decoded: describe(kind, d.label, amountUsdc),
    at: Date.now(),
    status: 'pending',
  };
}

/** A wallet that has been running for a few hours, so Home has something to show. */
export function seededKeys(): AgentKey[] {
  const key = makeKey('trader', 500, 24);
  const sixHoursAgo = Date.now() - 6 * 3600_000;
  key.issuedAt = sixHoursAgo;
  key.expiresAt = sixHoursAgo + 24 * 3600_000;
  const spends: [number, TxKind, number][] = [
    [120, 'swap', 5.5],
    [42.5, 'transfer', 3.2],
    [49.5, 'approve', 0.7],
  ];
  key.txs = spends.map(([amt, kind, hoursAgo]) => {
    const tx = makeTx(key.id, amt, kind, 'landed');
    tx.at = Date.now() - hoursAgo * 3600_000;
    return tx;
  });
  key.spentUsdc = key.txs.reduce((s, t) => s + t.amountUsdc, 0);
  return [key];
}

const blankState: State = {
  onboarded: false,
  address: null,
  wrist: { id: 'wrist-7C1E', connected: true, onArm: true, battery: 82 },
  managerRaiseLimit: 2000,
  keys: [],
  requests: [],
  signs: [],
  autopilot: false,
};

/**
 * EXPO_PUBLIC_SEED=full skips onboarding and starts with a live key, a pending
 * grant request and an over-cap request, so every screen can be reached by
 * deep link. Ids are fixed so links are stable: seed-key, seed-req, seed-sign.
 */
function seededState(): State {
  const keys = seededKeys();
  const key = keys[0]!;
  key.id = 'seed-key';
  key.txs = key.txs.map((t) => ({ ...t, keyId: key.id }));
  const req = makeGrantRequest('payroll', 150, 12);
  req.id = 'seed-req';
  const sign = makeSignRequest(key, 600, 'transfer');
  sign.id = 'seed-sign';
  return { ...blankState, onboarded: true, address: makeAddress(), keys, requests: [req], signs: [sign] };
}

export const initialState: State = process.env.EXPO_PUBLIC_SEED === 'full' ? seededState() : blankState;
