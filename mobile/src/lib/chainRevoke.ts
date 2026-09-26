import { evmRevokeMessage, phoneOnlySign } from './frost';
import * as evm from './evm';
import { listSessionAddresses } from './session';
import { loadShard, rand } from './shard';

/**
 * Revoke every live session key on the Leash account, signed by the phone's shard alone and
 * sent from the phone's gas wallet. Used by hold-to-revoke on Home and by holding B on the
 * wrist. Resolves with how many keys were revoked on-chain; never throws, since revoking
 * must not get in the way.
 */
export async function revokeAllOnChain(groupKey: string | null): Promise<number> {
  if (!groupKey) return 0;
  const shard = await loadShard();
  if (!shard) return 0;
  let revoked = 0;
  try {
    const o = await evm.overview(groupKey);
    if (!o.account) return 0;
    let nonce = o.nonce;
    for (const addr of await listSessionAddresses()) {
      const s = await evm.session(o.account, addr as `0x${string}`);
      if (s.expiry <= o.now) continue;
      const sig = phoneOnlySign(shard, evmRevokeMessage(o.chainId, o.account, nonce, addr), rand);
      const r = await evm.revoke(o.account, addr as `0x${string}`, sig);
      if (r.status === 'success') {
        revoked++;
        nonce++;
      }
    }
  } catch {
    // Offline or out of gas: the in-app revoke still stands.
  }
  return revoked;
}
