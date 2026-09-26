import { useSyncExternalStore } from 'react';
import { evmRevokeMessage, phoneOnlySign } from './frost';
import * as evm from './evm';
import { listSessionAddresses } from './session';
import { loadShard, rand } from './shard';
import { success } from './haptics';

type Report = { phase: 'idle' | 'working' | 'done' | 'error'; confirmed: number; error?: string; hash?: `0x${string}` };
let report: Report = { phase: 'idle', confirmed: 0 };
const listeners = new Set<() => void>();
let operation: Promise<void> | null = null;
const publish = (next: Report) => {
  report = next;
  listeners.forEach((fn) => fn());
};
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export const useRevocation = () =>
  useSyncExternalStore(
    subscribe,
    () => report,
    () => report,
  );

/** A key is revoked only after the chain confirms. Duplicate callers share one operation. */
export function revokeAllOnChain(groupKey: string | null): Promise<void> {
  if (operation) return operation;
  operation = run(groupKey).finally(() => {
    operation = null;
  });
  return operation;
}

async function run(groupKey: string | null) {
  const previousHash = report.hash;
  publish({ phase: 'working', confirmed: 0, hash: previousHash });
  let confirmed = 0;
  try {
    if (!groupKey) throw new Error('No wallet is connected.');
    const shard = await loadShard();
    if (!shard) throw new Error('This phone has no signing share.');
    // Reconcile a submitted transaction before signing another account nonce.
    if (previousHash) {
      await evm.pub.waitForTransactionReceipt({ hash: previousHash, timeout: 30_000 });
      publish({ phase: 'working', confirmed });
    }
    const o = await evm.overview(groupKey);
    if (!o.account) throw new Error('No Sepolia account is deployed.');
    for (const addr of await listSessionAddresses()) {
      const s = await evm.session(o.account, addr as `0x${string}`);
      if (s.expiry <= o.now) continue;
      const current = await evm.overview(groupKey);
      const sig = phoneOnlySign(shard, evmRevokeMessage(o.chainId, o.account, current.nonce, addr), rand);
      const r = await evm.revoke(o.account, addr as `0x${string}`, sig, (hash) =>
        publish({ phase: 'working', confirmed, hash }),
      );
      if (r.status !== 'success') {
        publish({ phase: 'working', confirmed });
        throw new Error('A revoke reverted. Review the wallet and retry.');
      }
      confirmed++;
      publish({ phase: 'working', confirmed });
    }
    publish({ phase: 'done', confirmed });
    void success();
  } catch (e) {
    publish({ ...report, phase: 'error', confirmed, error: evm.reason(e) });
  }
}
