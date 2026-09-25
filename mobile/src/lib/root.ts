/**
 * The 3-of-3 root key: phone (id 1), wrist (id 2), vault (id 3).
 *
 * It starts as a 2-of-2 between phone and wrist (the same key generation as the manager
 * key), then the vault joins with an additive reshare that keeps the group key:
 *   phone picks r1, wrist picks r2, each encrypts its piece to the vault's device key.
 *   vault share x3 = r1 + r2, phone x1' = x1 - r1, wrist x2' = x2 - r2.
 *   The phone checks X1' + X2' + X3 = P before anyone commits the new shares.
 * The phone never sees r2, so phone and wrist together cannot rebuild the vault's share.
 *
 * Signing is FROST for n parties with compressed points, matching firmware/wrist/src/frost.cpp:
 *   rho_i = H("LEASH/rhoN" || i || m || D_1 || E_1 || ... || D_n || E_n) mod n
 * Encryption to the vault: ECIES, key = sha256("LEASH/ecies" || ECDH x), AES-256-GCM,
 * wire format ephPub(33) || iv(12) || tag(16) || ciphertext.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import type { RandomBytes } from './frost';

const Point = secp256k1.Point;
const G = Point.BASE;
const N = Point.Fn.ORDER;
type Pt = InstanceType<typeof Point>;

const mod = (a: bigint) => ((a % N) + N) % N;
const big = (b: Uint8Array) => BigInt(`0x${bytesToHex(b) || '0'}`);
const s32 = (v: bigint) => v.toString(16).padStart(64, '0');
const isOdd = (p: Pt) => (p.toAffine().y & 1n) === 1n;
export const cpt = (p: Pt) => bytesToHex(p.toBytes(true));
export const pt = (h: string) => Point.fromBytes(hexToBytes(h));
const xOnly = (p: Pt) => p.toBytes(true).slice(1);

function randomScalar(rand: RandomBytes): bigint {
  for (;;) {
    const s = big(rand(32));
    if (s > 0n && s < N) return s;
  }
}

/** What the phone keeps for the root key. Shares are parity adjusted, public shares compressed. */
export interface RootShare {
  share: string; // phone's x1 (hex)
  groupKey: string; // x-only
  parties: 2 | 3;
  pub: Record<string, string>; // id -> compressed public share
  vaultPub?: string; // vault's device key, once added
}

// ---- reshare -----------------------------------------------------------------

export function ecies(pub: string, msg: Uint8Array, rand: RandomBytes): string {
  const V = pt(pub);
  const k = randomScalar(rand);
  const S = V.multiply(k);
  const key = sha256(concatBytes(utf8ToBytes('LEASH/ecies'), xOnly(S)));
  const iv = rand(12);
  const sealed = gcm(key, iv).encrypt(msg); // ciphertext || tag(16)
  const ct = sealed.slice(0, sealed.length - 16);
  const tag = sealed.slice(sealed.length - 16);
  return bytesToHex(concatBytes(G.multiply(k).toBytes(true), iv, tag, ct));
}

export function eciesOpen(priv: bigint, hex: string): Uint8Array {
  const b = hexToBytes(hex);
  const K = Point.fromBytes(b.slice(0, 33));
  const key = sha256(concatBytes(utf8ToBytes('LEASH/ecies'), xOnly(K.multiply(priv))));
  return gcm(key, b.slice(33, 45)).decrypt(concatBytes(b.slice(61), b.slice(45, 61)));
}

/** Phone's half of the reshare: new share, its public part, and r1 sealed to the vault. */
export function phoneReshare(r: RootShare, vaultPub: string, rand: RandomBytes) {
  const r1 = randomScalar(rand);
  const x1 = mod(big(hexToBytes(r.share)) - r1);
  return { x1: s32(x1), X1: cpt(G.multiply(x1)), sealed: ecies(vaultPub, hexToBytes(s32(r1)), rand) };
}

/** The group key must not move: X1' + X2' + X3 = P (x-only, even y). */
export function reshareCheck(groupKey: string, X1: string, X2: string, X3: string): boolean {
  const P = pt(X1).add(pt(X2)).add(pt(X3));
  return !isOdd(P) && bytesToHex(xOnly(P)) === groupKey;
}

// ---- n-party signing -----------------------------------------------------------

export interface Commit {
  id: number;
  D: string;
  E: string;
}

export interface RootNonces {
  d: bigint;
  e: bigint;
  D: string;
  E: string;
}

export function rootNonces(rand: RandomBytes): RootNonces {
  const d = randomScalar(rand);
  const e = randomScalar(rand);
  return { d, e, D: cpt(G.multiply(d)), E: cpt(G.multiply(e)) };
}

function rho(i: number, m: Uint8Array, cs: Commit[]): bigint {
  const parts = [utf8ToBytes('LEASH/rhoN'), new Uint8Array([i]), m];
  for (const c of cs) parts.push(hexToBytes(c.D), hexToBytes(c.E));
  return mod(big(sha256(concatBytes(...parts))));
}

/** R, the per-party nonce points (parity adjusted) and the challenge. */
function round(groupKey: string, m: Uint8Array, cs: Commit[]) {
  const sorted = [...cs].sort((a, b) => a.id - b.id);
  const Ri = new Map<number, Pt>();
  let R: Pt | null = null;
  const rhos = new Map<number, bigint>();
  for (const c of sorted) {
    const r = rho(c.id, m, sorted);
    rhos.set(c.id, r);
    const p = pt(c.D).add(pt(c.E).multiply(r));
    Ri.set(c.id, p);
    R = R ? R.add(p) : p;
  }
  const odd = isOdd(R!);
  const c = mod(big(schnorr.utils.taggedHash('BIP0340/challenge', xOnly(R!), hexToBytes(groupKey), m)));
  return { sorted, Ri, rhos, odd, c, Rx: xOnly(R!) };
}

/** A party's partial signature. Used by the phone and by the reference parties in tests. */
export function partial(share: string, groupKey: string, m: Uint8Array, cs: Commit[], id: number, n: RootNonces): string {
  const { rhos, odd, c } = round(groupKey, m, cs);
  let k = mod(n.d + rhos.get(id)! * n.e);
  if (odd) k = mod(-k);
  return s32(mod(k + c * big(hexToBytes(share))));
}

/**
 * Combine partials from all parties into a BIP340 signature. Every partial is checked
 * against that party's public share first, so a bad share is pinned on its owner.
 */
export function combineRoot(r: RootShare, m: Uint8Array, cs: Commit[], z: Record<number, string>): string {
  const { sorted, Ri, odd, c, Rx } = round(r.groupKey, m, cs);
  let s = 0n;
  for (const cm of sorted) {
    const zi = big(hexToBytes(z[cm.id]));
    let Rp = Ri.get(cm.id)!;
    if (odd) Rp = Rp.negate();
    const lhs = G.multiply(zi === 0n ? N : zi);
    if (zi === 0n || !lhs.equals(Rp.add(pt(r.pub[String(cm.id)]).multiply(c)))) {
      const who = cm.id === 1 ? 'phone' : cm.id === 2 ? 'wrist' : 'vault';
      throw new Error(`The ${who} signed with a share that does not match the root key.`);
    }
    s = mod(s + zi);
  }
  const sig = bytesToHex(concatBytes(Rx, hexToBytes(s32(s))));
  if (!schnorr.verify(hexToBytes(sig), m, hexToBytes(r.groupKey))) throw new Error('The root signature did not verify.');
  return sig;
}

// ---- the root action the demo signs -----------------------------------------------

export interface RootGrant {
  chainId: number;
  account: string;
  nonce: bigint;
  agent: string;
  cap: bigint;
  expiry: bigint;
}

const u256 = (v: bigint) => hexToBytes(v.toString(16).padStart(64, '0'));
const a20 = (a: string) => hexToBytes(a.toLowerCase().replace(/^0x/, '').padStart(40, '0'));

/** sha256("LEASH/rootgrant" || chainid || account || nonce || agent || cap || expiry) */
export function rootGrantMessage(g: RootGrant): Uint8Array {
  return sha256(concatBytes(utf8ToBytes('LEASH/rootgrant'), u256(BigInt(g.chainId)), a20(g.account), u256(g.nonce), a20(g.agent), u256(g.cap), u256(g.expiry)));
}

export const hex = bytesToHex;
export const unhex = hexToBytes;
export { randomScalar as _randomScalar, mod as _mod, G as _G, s32 as _s32, big as _big };
