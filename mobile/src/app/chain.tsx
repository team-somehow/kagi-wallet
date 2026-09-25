import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { Fact } from '../components/Fact';
import { ManagerSign, type SignPayload } from '../components/ManagerSign';
import { useStore } from '../store/store';
import { link, type Msg } from '../lib/link';
import { evmRevokeMessage, phoneKey, phoneOnlySign } from '../lib/frost';
import { loadShard, rand } from '../lib/shard';
import { unlockShard } from '../lib/biometrics';
import { shortAddr } from '../lib/format';
import { success, warn } from '../lib/haptics';
import { colors, radius, space } from '../theme';

interface Session {
  address: string;
  name: string;
  cap: string;
  spent: string;
  expiry: string;
  nonce: string;
  held: boolean;
}

interface Info {
  chainId: number;
  now: string;
  relayer: string | null;
  relayerBalance: string;
  account: string | null;
  accountBalance: string;
  nonce: string;
  sessions: Session[];
  deployCost: string;
  explorer: string;
}

// Testnet amounts, kept tiny so a small faucet drip goes a long way.
const TO = '0x000000000000000000000000000000000000dEaD';
const FUND = 20_000_000_000_000n; // 0.00002 ETH starts in the account
const CAP = 5_000_000_000_000n; // 0.000005 ETH per key
const SPEND = 2_000_000_000_000n; // 0.000002 ETH per agent spend
const LIFETIME = 3600n; // one hour

const eth = (wei: string | bigint) => {
  const v = Number(BigInt(wei)) / 1e18;
  return `${v.toFixed(v > 0 && v < 0.001 ? 6 : 4)} ETH`;
};

type Pending =
  | { kind: 'grant'; agent: string; expiry: bigint }
  | { kind: 'escalate'; agent: string; value: bigint }
  | null;

/** Real session keys on Sepolia: the agent spends under its cap with no one asked. */
export default function Chain() {
  const { state } = useStore();
  const groupKey = state.address;
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [log, setLog] = useState<{ label: string; hash: string; ok: boolean }[]>([]);

  const refresh = useCallback(async () => {
    if (!groupKey) return;
    try {
      const r = await link.request<Msg>({ t: 'evm_info?', groupKey }, 20000);
      if (r.t === 'evm_error') throw new Error(String(r.reason));
      setInfo(r as unknown as Info);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Sepolia through the hub.');
    }
  }, [groupKey]);

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  /** Send a chain request through the hub and record the transaction it produced. */
  const chain = async (label: string, m: Msg): Promise<boolean> => {
    setBusy(label);
    setError(null);
    try {
      const r = await link.request<Msg>({ ...m, groupKey }, 200000);
      if (r.t === 'evm_error') throw new Error(String(r.reason));
      if (r.hash) setLog((l) => [{ label, hash: String(r.hash), ok: r.status !== 'reverted' }, ...l]);
      void success();
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed.`);
      void warn();
      return false;
    } finally {
      setBusy(null);
    }
  };

  const deploy = async () => {
    const shard = await loadShard();
    if (!shard) return setError('This phone has no shard.');
    await chain('Account deployed', { t: 'evm_deploy', phoneKey: phoneKey(shard), fund: FUND.toString() });
  };

  const newKey = async () => {
    setError(null);
    try {
      const r = await link.request<Msg>({ t: 'evm_agent_key?', groupKey, name: 'trader' }, 15000);
      if (r.t === 'evm_error') throw new Error(String(r.reason));
      setPending({ kind: 'grant', agent: String(r.agent), expiry: BigInt(info?.now ?? '0') + LIFETIME });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The agent did not answer.');
    }
  };

  const agentSpend = async (s: Session, value: bigint) => {
    const ok = await chain('Agent spent on its own', { t: 'evm_agent_spend', agent: s.address, to: TO, value: value.toString() });
    // Over the cap: the contract refused the agent, so it has to ask you.
    if (!ok) setPending({ kind: 'escalate', agent: s.address, value });
  };

  const revoke = async (s: Session) => {
    if (!info?.account) return;
    const u = await unlockShard('Revoke this key');
    if (!u.ok) return setError(u.reason);
    const shard = await loadShard();
    if (!shard) return setError('This phone has no shard.');
    // The phone signs this alone. No wrist needed to stop a key.
    const sig = phoneOnlySign(shard, evmRevokeMessage(info.chainId, info.account, BigInt(info.nonce), s.address), rand);
    await chain('Key revoked by the phone alone', { t: 'evm_revoke', agent: s.address, sig });
  };

  const now = BigInt(info?.now ?? '0');
  const live = (s: Session) => BigInt(s.expiry) > now;
  const relayerLow = info ? BigInt(info.relayerBalance) < 100_000_000_000_000n : false;

  const signPayload: SignPayload | null =
    !info?.account || !pending
      ? null
      : pending.kind === 'grant'
        ? { kind: 'evm_grant', agent: 'trader', chainId: info.chainId, account: info.account, nonce: BigInt(info.nonce), agentAddress: pending.agent, cap: CAP, expiry: pending.expiry }
        : { kind: 'evm', agent: 'trader', chainId: info.chainId, account: info.account, nonce: BigInt(info.nonce), to: TO, value: pending.value, data: '0x' };

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        Sepolia
      </Txt>
      <Txt size={16} color={colors.muted} style={styles.lead}>
        Agents spend under their cap with their own key and nobody is asked. Over the cap, the contract refuses and it comes to you.
      </Txt>

      <View style={styles.facts}>
        <Fact label="Account" value={info?.account ? shortAddr(info.account, 8, 6) : info ? 'not deployed' : 'loading'} />
        <Fact label="Balance" value={info?.account ? eth(info.accountBalance) : '–'} />
        <Fact label="Gas paid by" value={info?.relayer ? `${shortAddr(info.relayer, 6, 4)}, ${eth(info.relayerBalance)}` : '–'} color={relayerLow ? colors.red : colors.text} />
      </View>

      {error ? (
        <Txt size={14} color={colors.red} style={styles.note}>
          {error}
        </Txt>
      ) : null}
      {busy ? (
        <Txt size={14} color={colors.amber} style={styles.note}>
          {busy.replace(/ed( on its own| by the phone alone)?$/, 'ing')}…
        </Txt>
      ) : null}

      {!info ? null : !info.account ? (
        <View style={styles.actions}>
          <Button label="Deploy the account" onPress={() => void deploy()} loading={busy !== null} disabled={busy !== null} />
        </View>
      ) : (
        <>
          <View style={styles.section}>
            <Txt size={15} weight="medium" color={colors.muted}>
              Session keys
            </Txt>
            {info.sessions.length === 0 ? (
              <Txt size={15} color={colors.faint}>
                None yet.
              </Txt>
            ) : (
              info.sessions.map((s) => (
                <View key={s.address} style={[styles.session, !live(s) && styles.dim]}>
                  <View style={styles.row}>
                    <Txt size={16} weight="medium">
                      {s.name}
                    </Txt>
                    <Txt mono size={12} color={colors.muted}>
                      {shortAddr(s.address, 6, 4)}
                    </Txt>
                  </View>
                  <Txt mono size={13} color={colors.muted}>
                    {eth(s.spent)} of {eth(s.cap)} · {live(s) ? `${Math.max(0, Math.round(Number(BigInt(s.expiry) - now) / 60))} min left` : BigInt(s.expiry) === 0n ? 'revoked' : 'expired'}
                  </Txt>
                  {live(s) && !pending ? (
                    <View style={styles.buttons}>
                      <Button label={`Agent spends ${eth(SPEND)}`} variant="secondary" onPress={() => void agentSpend(s, SPEND)} disabled={busy !== null} style={styles.small} />
                      <Button label="Agent goes over the cap" variant="secondary" onPress={() => void agentSpend(s, BigInt(s.cap) + 1n)} disabled={busy !== null} style={styles.small} />
                      <Button label="Revoke with the phone alone" variant="danger" onPress={() => void revoke(s)} disabled={busy !== null} style={styles.small} />
                    </View>
                  ) : null}
                </View>
              ))
            )}
            {!pending ? <Button label={`Issue a key, ${eth(CAP)} for 1 hour`} onPress={() => void newKey()} disabled={busy !== null} /> : null}
          </View>

          {pending && signPayload ? (
            <View style={styles.section}>
              <Txt size={15} weight="medium" color={colors.amber}>
                {pending.kind === 'grant' ? 'The agent made a key and asks for a cap' : 'Over the cap. The contract refused the agent.'}
              </Txt>
              <Txt size={14} color={colors.muted}>
                {pending.kind === 'grant'
                  ? `Agent key ${shortAddr(pending.agent, 6, 4)}. Its private half never leaves the agent.`
                  : `It wants to send ${eth(pending.value)}. Sign it with phone and wrist, or leave it.`}
              </Txt>
              <ManagerSign
                key={`${pending.kind}-${info.nonce}`}
                action={pending.kind === 'grant' ? 'Sign the grant' : 'Sign it anyway'}
                phoneDetail="Unlock to sign with the phone shard"
                payload={signPayload}
                onDone={(sig) => {
                  const p = pending;
                  setPending(null);
                  if (p.kind === 'grant') void chain('Key granted', { t: 'evm_grant', agent: p.agent, name: 'trader', cap: CAP.toString(), expiry: p.expiry.toString(), sig });
                  else void chain('Co-signed by phone and wrist', { t: 'evm_submit', to: TO, value: p.value.toString(), data: '0x', sig });
                }}
              />
              <Button label="Leave it" variant="ghost" onPress={() => setPending(null)} />
            </View>
          ) : null}
        </>
      )}

      {log.length ? (
        <View style={styles.section}>
          <Txt size={15} weight="medium" color={colors.muted}>
            On Sepolia
          </Txt>
          {log.map((l) => (
            <Pressable key={l.hash} accessibilityRole="link" onPress={() => void Linking.openURL(`${info?.explorer ?? 'https://sepolia.etherscan.io'}/tx/${l.hash}`)} style={styles.tx}>
              <Txt size={15} color={l.ok ? colors.text : colors.red}>
                {l.label}
              </Txt>
              <Txt mono size={11} color={colors.muted}>
                {l.hash}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.m },
  facts: { marginTop: space.l },
  note: { marginTop: space.m },
  actions: { marginTop: space.xl },
  section: { marginTop: space.xl, gap: space.s },
  session: { padding: space.m, gap: 6, backgroundColor: colors.panel, borderRadius: radius.m },
  dim: { opacity: 0.55 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  buttons: { gap: space.s, marginTop: space.s },
  small: { minHeight: 44 },
  tx: { paddingVertical: 10, gap: 2, borderBottomWidth: 1, borderBottomColor: colors.line },
});
