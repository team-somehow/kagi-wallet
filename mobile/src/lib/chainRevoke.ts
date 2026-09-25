import { evmRevokeMessage, phoneOnlySign } from './frost';
import { link, type Msg } from './link';
import { loadShard, rand } from './shard';

/**
 * Revoke every live session key on the Leash account, signed by the phone's shard alone.
 * Used by hold-to-revoke on Home and by holding B on the wrist. Resolves with how many
 * keys were revoked on-chain; never throws, since revoking must not get in the way.
 */
export async function revokeAllOnChain(groupKey: string | null): Promise<number> {
  if (!groupKey) return 0;
  const shard = await loadShard();
  if (!shard) return 0;
  let revoked = 0;
  try {
    const info = await link.request<Msg>({ t: 'evm_info?', groupKey }, 20000);
    if (info.t !== 'evm_info' || !info.account) return 0;
    const now = BigInt(String(info.now));
    let nonce = BigInt(String(info.nonce));
    const sessions = (info.sessions as { address: string; expiry: string }[]) ?? [];
    for (const s of sessions) {
      if (BigInt(s.expiry) <= now) continue;
      const sig = phoneOnlySign(shard, evmRevokeMessage(Number(info.chainId), String(info.account), nonce, s.address), rand);
      const r = await link.request<Msg>({ t: 'evm_revoke', groupKey, agent: s.address, sig }, 200000);
      if (r.t === 'evm_result') {
        revoked++;
        nonce++;
      }
    }
  } catch {
    // Offline or out of gas: the in-app revoke still stands.
  }
  return revoked;
}
