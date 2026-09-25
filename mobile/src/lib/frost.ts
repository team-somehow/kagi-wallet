/**
 * Two-party threshold Schnorr for the Leash manager key (phone + wrist, 2 of 2).
 *
 * The output is a plain BIP340 Schnorr signature over the group key, so any
 * standard verifier accepts it. The protocol is FROST specialised to n = t = 2
 * with additive shares. It has to match firmware/wrist/src/frost.cpp byte for byte.
 *
 * Wire format: scalars are 32 byte big endian hex, points are 65 byte
 * uncompressed hex (04 || x || y).
 *
 * Key generation
 *   each party i picks x_i, publishes X_i = x_i G and a proof of possession
 *   pop_i = (R, s) with c = H("LEASH/pop" || R || X_i), s = k + c x_i.
 *   P = X_1 + X_2. If P has odd y, both negate x_i and X_i, so P is even-y.
 *
 * Signing message m (32 bytes), participant ids 1 (phone) and 2 (wrist)
 *   each party picks nonces d_i, e_i and publishes D_i, E_i.
 *   rho_i = H("LEASH/rho" || i || m || D_1 || E_1 || D_2 || E_2) mod n
 *   R_i = D_i + rho_i E_i,  R = R_1 + R_2.  If R has odd y, negate every k_i.
 *   c = BIP340 challenge tagged_hash("BIP0340/challenge", R.x || P.x || m)
 *   z_i = k_i + c x_i where k_i = d_i + rho_i e_i
 *   signature = R.x || (z_1 + z_2)
 */
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

const Point = secp256k1.Point;
const G = Point.BASE;
const Fn = Point.Fn;
const N = Fn.ORDER;

export type Hex = string;
export type RandomBytes = (n: number) => Uint8Array;

const mod = (a: bigint) => ((a % N) + N) % N;
const toBig = (b: Uint8Array) => BigInt(`0x${bytesToHex(b) || '0'}`);
const scalarHex = (s: bigint) => s.toString(16).padStart(64, '0');
export const pointHex = (p: InstanceType<typeof Point>) => bytesToHex(p.toBytes(false));
export const parsePoint = (h: Hex) => Point.fromBytes(hexToBytes(h));
const isOdd = (p: InstanceType<typeof Point>) => (p.toAffine().y & 1n) === 1n;
const xOnly = (p: InstanceType<typeof Point>) => p.toBytes(true).slice(1);

function hashToScalar(...parts: Uint8Array[]): bigint {
  return mod(toBig(sha256(concatBytes(...parts))));
}

function randomScalar(rand: RandomBytes): bigint {
  for (;;) {
    const s = toBig(rand(32));
    if (s > 0n && s < N) return s;
  }
}

/** The message both sides sign. The wrist rebuilds this itself from what it shows. */
export function messageFor(canonical: string): Uint8Array {
  return sha256(utf8ToBytes(canonical));
}

export function grantCanonical(agent: string, pubkey: string, capUsdc: number, hours: number): string {
  return `grant|${agent}|${pubkey.toLowerCase()}|${Math.round(capUsdc * 1_000_000)}|${hours}`;
}

export function txCanonical(to: string, calldata: string): string {
  return `tx|${to.toLowerCase()}|${calldata.toLowerCase()}`;
}

/**
 * Bytes the Leash smart account hashes (see contracts/LeashAccount.sol):
 *   "LEASH/evm" || chainid (32) || account (20) || nonce (32) || to (20) || value (32) || data
 * The wrist builds the same bytes from the fields it displays.
 */
export interface EvmCall {
  chainId: number;
  account: string;
  nonce: bigint;
  to: string;
  value: bigint;
  data: string;
}

const u256 = (v: bigint) => hexToBytes(v.toString(16).padStart(64, '0'));
const addr = (a: string) => hexToBytes(a.toLowerCase().replace(/^0x/, '').padStart(40, '0'));

export function evmPreimage(c: EvmCall): Uint8Array {
  return concatBytes(
    utf8ToBytes('LEASH/evm'),
    u256(BigInt(c.chainId)),
    addr(c.account),
    u256(c.nonce),
    addr(c.to),
    u256(c.value),
    hexToBytes(c.data.replace(/^0x/, '')),
  );
}

export function evmMessage(c: EvmCall): Uint8Array {
  return sha256(evmPreimage(c));
}

export interface EvmGrant {
  chainId: number;
  account: string;
  nonce: bigint;
  agent: string;
  cap: bigint;
  expiry: bigint;
}

/** sha256("LEASH/grant" || chainid || account || nonce || agent || cap || expiry) */
export function evmGrantMessage(g: EvmGrant): Uint8Array {
  return sha256(
    concatBytes(utf8ToBytes('LEASH/grant'), u256(BigInt(g.chainId)), addr(g.account), u256(g.nonce), addr(g.agent), u256(g.cap), u256(g.expiry)),
  );
}

export interface EvmLimit {
  chainId: number;
  account: string;
  nonce: bigint;
  agent: string;
  oldCap: bigint;
  newCap: bigint;
  expiry: bigint;
}

/** sha256("LEASH/limit" || chainid || account || nonce || agent || oldCap || newCap || expiry) */
export function evmLimitMessage(l: EvmLimit): Uint8Array {
  return sha256(
    concatBytes(
      utf8ToBytes('LEASH/limit'),
      u256(BigInt(l.chainId)),
      addr(l.account),
      u256(l.nonce),
      addr(l.agent),
      u256(l.oldCap),
      u256(l.newCap),
      u256(l.expiry),
    ),
  );
}

/** sha256("LEASH/revoke" || chainid || account || nonce || agent). The phone signs this alone. */
export function evmRevokeMessage(chainId: number, account: string, nonce: bigint, agent: string): Uint8Array {
  return sha256(concatBytes(utf8ToBytes('LEASH/revoke'), u256(BigInt(chainId)), addr(account), u256(nonce), addr(agent)));
}

/** sha256("LEASH/1271" || chainid || account || hash). What the manager signs for ERC-1271. */
export function evm1271Message(chainId: number, account: string, hash: Hex): Uint8Array {
  return sha256(concatBytes(utf8ToBytes('LEASH/1271'), u256(BigInt(chainId)), addr(account), hexToBytes(hash.replace(/^0x/, ''))));
}

/** A plain BIP340 signature by the phone's shard alone. The contract accepts it for revoking only. */
export function phoneOnlySign(s: Share, m: Uint8Array, rand: RandomBytes): Hex {
  return bytesToHex(schnorr.sign(m, hexToBytes(s.share), rand(32)));
}

/** x-only key the contract checks phone-only signatures against. */
export function phoneKey(s: Share): Hex {
  return bytesToHex(schnorr.getPublicKey(hexToBytes(s.share)));
}

/** Pairing code both screens show. Pure display check, no secrets. */
export function pairingCode(phoneNonce: Hex, wristNonce: Hex): string {
  const h = bytesToHex(sha256(concatBytes(utf8ToBytes('LEASH/pair'), hexToBytes(phoneNonce), hexToBytes(wristNonce))));
  return `${h.slice(0, 4)} ${h.slice(4, 8)}`.toUpperCase();
}

// ---- proof of possession ------------------------------------------------

export interface Pop {
  R: Hex;
  s: Hex;
}

function popChallenge(R: InstanceType<typeof Point>, X: InstanceType<typeof Point>): bigint {
  return hashToScalar(utf8ToBytes('LEASH/pop'), R.toBytes(false), X.toBytes(false));
}

export function popVerify(Xh: Hex, pop: Pop): boolean {
  try {
    const X = parsePoint(Xh);
    const R = parsePoint(pop.R);
    const s = toBig(hexToBytes(pop.s));
    if (s <= 0n || s >= N) return false;
    return G.multiply(s).equals(R.add(X.multiply(popChallenge(R, X))));
  } catch {
    return false;
  }
}

// ---- key generation -------------------------------------------------------

export interface DkgStart {
  x: bigint;
  X: Hex;
  pop: Pop;
}

export function dkgStart(rand: RandomBytes): DkgStart {
  const x = randomScalar(rand);
  const X = G.multiply(x);
  const k = randomScalar(rand);
  const R = G.multiply(k);
  const s = mod(k + popChallenge(R, X) * x);
  return { x, X: pointHex(X), pop: { R: pointHex(R), s: scalarHex(s) } };
}

/** What the phone keeps. share and the two public shares are already parity adjusted. */
export interface Share {
  id: 1;
  share: Hex;
  X1: Hex;
  X2: Hex;
  groupKey: Hex; // 32 byte x-only, BIP340 style
}

export function dkgFinish(mine: DkgStart, wristX: Hex, wristPop: Pop): Share {
  if (!popVerify(wristX, wristPop)) throw new Error('The wrist sent a key it cannot prove it holds.');
  let X1 = parsePoint(mine.X);
  let X2 = parsePoint(wristX);
  let x = mine.x;
  const P = X1.add(X2);
  if (isOdd(P)) {
    x = mod(-x);
    X1 = X1.negate();
    X2 = X2.negate();
  }
  const Pe = X1.add(X2);
  return { id: 1, share: scalarHex(x), X1: pointHex(X1), X2: pointHex(X2), groupKey: bytesToHex(xOnly(Pe)) };
}

// ---- signing --------------------------------------------------------------

export interface Nonces {
  d: bigint;
  e: bigint;
  D: Hex;
  E: Hex;
}

export function nonces(rand: RandomBytes): Nonces {
  const d = randomScalar(rand);
  const e = randomScalar(rand);
  return { d, e, D: pointHex(G.multiply(d)), E: pointHex(G.multiply(e)) };
}

function rho(i: number, m: Uint8Array, D1: Hex, E1: Hex, D2: Hex, E2: Hex): bigint {
  return hashToScalar(
    utf8ToBytes('LEASH/rho'),
    new Uint8Array([i]),
    m,
    hexToBytes(D1),
    hexToBytes(E1),
    hexToBytes(D2),
    hexToBytes(E2),
  );
}

export interface WristShare {
  D2: Hex;
  E2: Hex;
  z2: Hex;
}

/**
 * Finish a signature once the wrist has answered. Checks the wrist's partial
 * signature on its own, then the combined signature with a stock BIP340 verifier.
 */
export function combine(s: Share, m: Uint8Array, mine: Nonces, w: WristShare): Hex {
  const rho1 = rho(1, m, mine.D, mine.E, w.D2, w.E2);
  const rho2 = rho(2, m, mine.D, mine.E, w.D2, w.E2);
  let R1 = parsePoint(mine.D).add(parsePoint(mine.E).multiply(rho1));
  let R2 = parsePoint(w.D2).add(parsePoint(w.E2).multiply(rho2));
  const R = R1.add(R2);
  let k1 = mod(mine.d + rho1 * mine.e);
  if (isOdd(R)) {
    k1 = mod(-k1);
    R1 = R1.negate();
    R2 = R2.negate();
  }
  const Rx = xOnly(R);
  const c = mod(toBig(schnorr.utils.taggedHash('BIP0340/challenge', Rx, hexToBytes(s.groupKey), m)));

  const z2 = toBig(hexToBytes(w.z2));
  if (!G.multiply(z2 === 0n ? N : z2).equals(R2.add(parsePoint(s.X2).multiply(c))) || z2 === 0n) {
    throw new Error('The wrist signed with a share that does not match this wallet.');
  }
  const z1 = mod(k1 + c * toBig(hexToBytes(s.share)));
  const sig = bytesToHex(concatBytes(Rx, hexToBytes(scalarHex(mod(z1 + z2)))));
  if (!schnorr.verify(hexToBytes(sig), m, hexToBytes(s.groupKey))) {
    throw new Error('The combined signature did not verify.');
  }
  return sig;
}

// ---- reference wrist, for tests only ---------------------------------------

/** The wrist half, written the same way the firmware does it. Used by the protocol test. */
export const reference = {
  dkg(rand: RandomBytes, phoneX: Hex, phonePop: Pop) {
    if (!popVerify(phoneX, phonePop)) throw new Error('bad phone pop');
    const mine = dkgStart(rand);
    const P = parsePoint(phoneX).add(parsePoint(mine.X));
    const x = isOdd(P) ? mod(-mine.x) : mine.x;
    const Pe = isOdd(P) ? P.negate() : P;
    return { reply: { X: mine.X, pop: mine.pop }, x, groupKey: bytesToHex(xOnly(Pe)) };
  },
  sign(rand: RandomBytes, x: bigint, groupKey: Hex, m: Uint8Array, D1: Hex, E1: Hex): WristShare {
    const n = nonces(rand);
    const rho1 = rho(1, m, D1, E1, n.D, n.E);
    const rho2 = rho(2, m, D1, E1, n.D, n.E);
    const R = parsePoint(D1).add(parsePoint(E1).multiply(rho1)).add(parsePoint(n.D).add(parsePoint(n.E).multiply(rho2)));
    let k2 = mod(n.d + rho2 * n.e);
    if (isOdd(R)) k2 = mod(-k2);
    const c = mod(toBig(schnorr.utils.taggedHash('BIP0340/challenge', xOnly(R), hexToBytes(groupKey), m)));
    return { D2: n.D, E2: n.E, z2: scalarHex(mod(k2 + c * x)) };
  },
};
