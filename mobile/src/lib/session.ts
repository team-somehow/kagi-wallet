import * as SecureStore from 'expo-secure-store';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { rand } from './shard';

/**
 * Session keys the phone made for agents. The private key lives only in the phone's secure
 * store until the owner copies it into an agent. It spends within its on-chain allowance and
 * nothing else: it is not a share of the manager key.
 */
export interface SessionKey {
  address: string;
  privateKey: string;
  name: string;
  createdAt: number;
}

const INDEX = 'kagi.sessions.v1';
const keyName = (address: string) => `kagi.session.${address.toLowerCase().slice(2)}`;

/**
 * What the owner copies into an agent: the Kagi account, then the session key. A raw key
 * does not say which wallet it belongs to, so the account travels with it.
 */
export function connectionString(k: SessionKey, account: string): string {
  return `kagi:${account}:${k.privateKey}`;
}

/** The shared Kagi MCP server. Anyone's connector link points here. */
export const MCP_URL = (process.env.EXPO_PUBLIC_MCP_URL ?? 'https://13-235-16-182.sslip.io').replace(/\/+$/, '');

/**
 * A link that connects ChatGPT, Claude or any MCP client to this key: paste it as a connector.
 * It carries the account and the key, so it is as secret as the key itself.
 */
export function connectorLink(k: SessionKey, account: string): string {
  return `${MCP_URL}/k/${account.replace(/^0x/, '')}${k.privateKey.replace(/^0x/, '')}`;
}

export function newSessionKey(name: string): SessionKey {
  let priv: Uint8Array;
  do priv = rand(32);
  while (!secp256k1.utils.isValidSecretKey(priv));
  const pub = secp256k1.getPublicKey(priv, false).slice(1);
  const address = `0x${bytesToHex(keccak_256(pub).slice(-20))}`;
  return { address, privateKey: `0x${bytesToHex(priv)}`, name, createdAt: Date.now() };
}

export async function saveSessionKey(k: SessionKey) {
  await SecureStore.setItemAsync(keyName(k.address), JSON.stringify(k));
  const idx = await listSessionAddresses();
  if (!idx.includes(k.address.toLowerCase())) await SecureStore.setItemAsync(INDEX, JSON.stringify([...idx, k.address.toLowerCase()]));
}

export async function listSessionAddresses(): Promise<string[]> {
  try {
    return JSON.parse((await SecureStore.getItemAsync(INDEX)) ?? '[]');
  } catch {
    return [];
  }
}

export async function loadSessionKey(address: string): Promise<SessionKey | null> {
  try {
    const v = await SecureStore.getItemAsync(keyName(address));
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
