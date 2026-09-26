/**
 * Reset everything: erase the Kagi Wallet's share, then this phone's. The Kagi Wallet goes first and must
 * confirm with a long press on A. Only once it reports itself unpaired does the phone delete
 * anything, so declining on the Kagi Wallet (a tap), or losing the connection, leaves both halves intact.
 *
 * What it doesn't touch: the wallet contract and its funds stay on-chain (without both shares,
 * nobody can move them again), the gas wallet stays so the next wallet can be paid for, and
 * a second stick keeps its own root share, which is simply never used again.
 */
import * as SecureStore from 'expo-secure-store';
import { link } from './link';
import { clearPendingJoin, deleteShard } from './shard';

const WAIT_MS = 60_000;

export type ResetStep = 'confirm_on_wrist' | 'erasing_phone' | 'done';

async function del(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // nothing stored
  }
}

/** Throws with a readable message if the Kagi Wallet isn't there or doesn't confirm. Nothing is deleted then. */
export async function resetEverything(onStep: (s: ResetStep) => void): Promise<void> {
  const unpaired = link.waitFor((m) => m.t === 'hello' && m.role !== 'vault' && m.paired === false, WAIT_MS, 'the Kagi Wallet');
  if (!link.send({ t: 'wipe' })) {
    throw new Error('Connect the Kagi Wallet first. Its share has to be erased together with this phone’s.');
  }
  onStep('confirm_on_wrist');
  try {
    await unpaired;
  } catch (e) {
    throw new Error(
      e instanceof Error && e.message.startsWith('No answer')
        ? 'The Kagi Wallet did not confirm, so nothing was erased. Hold the Kagi Wallet’s button to erase, or tap it to keep everything.'
        : `${e instanceof Error ? e.message : String(e)} Nothing was erased.`,
    );
  }

  onStep('erasing_phone');
  const sessions: string[] = await SecureStore.getItemAsync('kagi.sessions.v1')
    .then((v) => JSON.parse(v ?? '[]'))
    .catch(() => []);
  await Promise.all([
    deleteShard(),
    del('kagi.root-shard.v1'),
    clearPendingJoin().catch(() => {}),
    del('kagi.agent-demo.v1'),
    ...sessions.map((a) => del(`kagi.session.${a.toLowerCase().replace(/^0x/, '')}`)),
    del('kagi.sessions.v1'),
  ]);
  onStep('done');
}
