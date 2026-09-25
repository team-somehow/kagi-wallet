import * as SecureStore from 'expo-secure-store';
import { getRandomBytes } from 'expo-crypto';
import type { Share } from './frost';

const KEY = 'leash.phone-shard.v1';

/** Cryptographically secure bytes from the OS. */
export const rand = (n: number) => getRandomBytes(n);

/** The phone's half of the manager key. Kept in the Android Keystore backed secure store. */
export async function loadShard(): Promise<Share | null> {
  try {
    const v = await SecureStore.getItemAsync(KEY);
    return v ? (JSON.parse(v) as Share) : null;
  } catch {
    return null;
  }
}

export async function saveShard(s: Share): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(s));
}

export async function deleteShard(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // nothing stored
  }
}

const ROOT_KEY = 'leash.root-shard.v1';

/** The phone's share of the root key (3-of-3 with wrist and vault once the vault joins). */
export async function loadRoot(): Promise<import('./root').RootShare | null> {
  try {
    const v = await SecureStore.getItemAsync(ROOT_KEY);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export async function saveRoot(r: import('./root').RootShare): Promise<void> {
  await SecureStore.setItemAsync(ROOT_KEY, JSON.stringify(r));
}
