import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { HoldButton } from '../components/HoldButton';
import { LedBar } from '../components/LedBar';
import { WristChip } from '../components/WristChip';
import { useStore } from '../store/store';
import { fmtEth, useChain, type ChainSession } from '../store/chain';
import * as Clipboard from 'expo-clipboard';
import * as evm from '../lib/evm';
import { loadShard } from '../lib/shard';
import { phoneKey } from '../lib/frost';
import { shortAddr } from '../lib/format';
import { success, tap, warn } from '../lib/haptics';
import { revokeAllOnChain } from '../lib/chainRevoke';
import { colors, radius, space } from '../theme';

const FUND = 50_000_000_000_000n; // 0.00005 ETH
// Below this the phone can do only a couple more transactions.
const LOW_GAS = 600_000_000_000_000n; // 0.0006 ETH

/** The wallet at a glance: the account, the agent's access, and what it did. */
export default function Home() {
  const { state } = useStore();
  const { info, error, live, sessions, totals, activity, limits, refresh } = useChain();
  const [gasCopied, setGasCopied] = useState(false);
  const earlier = sessions.filter((x) => x.status !== 'active');
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const waiting = Object.values(limits).filter((l) => l.status === 'waiting' || l.status === 'submitting');
  const explorer = info?.explorer ?? 'https://sepolia.etherscan.io';

  const deploy = async () => {
    const s = await loadShard();
    if (!s) return;
    setDeploying(true);
    setDeployError(null);
    try {
      await evm.deploy(s.groupKey, phoneKey(s), FUND);
      void success();
      await refresh();
    } catch (e) {
      setDeployError(evm.reason(e));
      void warn();
    } finally {
      setDeploying(false);
    }
  };

  const revokeAll = () => {
    void revokeAllOnChain(state.address).then(() => refresh());
  };

  const ratio = totals.cap > 0n ? Number(totals.spent) / Number(totals.cap) : 0;

  return (
    <Screen
      scroll
      footer={
        live.length > 0 ? (
          <View style={styles.footer}>
            <HoldButton label={live.length === 1 ? 'Hold to revoke the agent key' : `Hold to revoke all ${live.length} keys`} onComplete={revokeAll} />
          </View>
        ) : null
      }
    >
      <View style={styles.bar}>
        <Txt size={20} weight="bold" style={styles.mark}>
          Leash
        </Txt>
        <View style={styles.barRight}>
          <WristChip wrist={state.wrist} address={state.address} onPress={() => router.push('/wrist')} />
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void tap();
              router.push('/demo');
            }}
            style={({ pressed }) => [styles.more, pressed && styles.pressed]}
          >
            <Txt size={13} weight="medium" color={colors.muted}>
              More
            </Txt>
          </Pressable>
        </View>
      </View>

      {error && !info ? (
        <Txt size={14} color={colors.red} style={styles.top}>
          {error}
        </Txt>
      ) : null}

      {waiting.map((l) => (
        <Pressable key={l.id} onPress={() => router.push(`/limit/${l.id}`)} style={({ pressed }) => [styles.request, pressed && styles.pressed]}>
          <Txt size={17} weight="medium">
            {l.status === 'waiting' ? `${l.name} is waiting for approval` : 'New limit confirming on Sepolia'}
          </Txt>
          <Txt size={14} color={colors.muted}>
            Raise its total from {fmtEth(l.oldCap)} to {fmtEth(l.newCap)}
          </Txt>
        </Pressable>
      ))}

      <View style={styles.account}>
        <Txt size={15} color={colors.muted}>
          Wallet on Sepolia
        </Txt>
        {info?.account ? (
          <>
            <Txt mono size={40} weight="bold" lineHeight={50}>
              {fmtEth(info.balance)}
            </Txt>
            <Pressable onPress={() => void Linking.openURL(`${explorer}/address/${info.account}`)}>
              <Txt mono size={13} color={colors.muted}>
                {shortAddr(info.account)}  view on Etherscan
              </Txt>
            </Pressable>
          </>
        ) : info ? (
          <View style={styles.gap}>
            <Txt size={16} color={colors.faint}>
              This wallet is not on Sepolia yet.
            </Txt>
            {deployError ? (
              <Txt size={14} color={colors.red}>
                {deployError}
              </Txt>
            ) : null}
            <Button label={deploying ? 'Creating account' : 'Create Sepolia account'} loading={deploying} onPress={() => void deploy()} />
          </View>
        ) : (
          <Txt size={16} color={colors.faint}>
            Reading Sepolia
          </Txt>
        )}
      </View>

      {info?.account ? (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Txt size={15} weight="medium" color={colors.muted}>
              Agent access
            </Txt>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => router.push('/agent')} style={({ pressed }) => pressed && styles.pressed}>
              <Txt size={15} weight="medium" color={colors.amber}>
                New agent key
              </Txt>
            </Pressable>
          </View>
          {live.length > 0 ? (
            <View style={styles.summary}>
              <Txt mono size={28} weight="bold" color={ratio >= 0.8 ? colors.amber : colors.text}>
                {fmtEth(totals.left)}
              </Txt>
              <Txt size={13} color={colors.muted}>
                Agents can still spend, across {live.length} {live.length === 1 ? 'key' : 'keys'}
              </Txt>
            </View>
          ) : (
            <View style={styles.card}>
              <Txt size={16} color={colors.faint}>
                No agent can spend. Give one a key with a total allowance and an expiry.
              </Txt>
              <Button label="Give an agent a key" onPress={() => router.push('/agent')} />
            </View>
          )}
          {live.map((k) => (
            <KeyCard key={k.address} k={k} now={info.now} />
          ))}
          {earlier.length > 0 ? (
            <>
              <Txt size={15} weight="medium" color={colors.muted} style={styles.earlier}>
                Earlier
              </Txt>
              {earlier.map((k) => (
                <KeyCard key={k.address} k={k} now={info.now} />
              ))}
            </>
          ) : null}
        </View>
      ) : null}

      {info ? (
        <View style={styles.section}>
          <Txt size={15} weight="medium" color={colors.muted}>
            Gas wallet
          </Txt>
          <View style={styles.card}>
            <View style={styles.row}>
              <Txt mono size={15} color={info.gasBalance < LOW_GAS ? colors.amber : colors.text}>
                {fmtEth(info.gasBalance)}
              </Txt>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  void Clipboard.setStringAsync(info.gasAddress).then(() => {
                    setGasCopied(true);
                    setTimeout(() => setGasCopied(false), 2500);
                  });
                }}
              >
                <Txt mono size={13} color={colors.muted}>
                  {gasCopied ? 'Copied' : shortAddr(info.gasAddress)}
                </Txt>
              </Pressable>
            </View>
            <Txt size={13} color={info.gasBalance < LOW_GAS ? colors.amber : colors.faint}>
              {info.gasBalance < LOW_GAS
                ? 'Running low. Send Sepolia ETH to this address, or the phone cannot grant, revoke or decide limits.'
                : 'Pays the phone’s Sepolia fees. It has no power over your wallet.'}
            </Txt>
          </View>
        </View>
      ) : null}

      {activity.length > 0 ? (
        <View style={styles.section}>
          <Txt size={15} weight="medium" color={colors.muted}>
            Activity
          </Txt>
          {activity.map((a) => (
            <Pressable
              key={a.key}
              disabled={!a.hash}
              onPress={() => a.hash && void Linking.openURL(`${explorer}/tx/${a.hash}`)}
              style={({ pressed }) => [styles.act, pressed && styles.pressed]}
            >
              <View style={styles.row}>
                <Txt size={15} color={a.status === 'failed' ? colors.red : colors.text}>
                  {a.text}
                </Txt>
                <Txt size={12} color={colors.faint}>
                  {new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Txt>
              </View>
              <Txt size={13} color={colors.muted}>
                {a.name}
                {a.to ? ` to ${shortAddr(a.to)}` : ''}
                {a.hash ? `  ${shortAddr(a.hash, 8, 4)}` : ''}
              </Txt>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function KeyCard({ k, now }: { k: ChainSession; now: bigint }) {
  const on = k.status === 'active';
  const left = k.cap > k.spent ? k.cap - k.spent : 0n;
  const ratio = k.cap > 0n ? Number(k.spent) / Number(k.cap) : 0;
  const minutes = Math.max(0, Math.round(Number(k.expiry - now) / 60));
  return (
    <Pressable onPress={() => router.push(`/session/${k.address}`)} style={({ pressed }) => [styles.card, !on && styles.off, pressed && styles.pressed]}>
      <View style={styles.row}>
        <Txt size={17} weight="medium" color={on ? colors.text : colors.muted}>
          {k.name}
        </Txt>
        <Txt size={13} color={on ? colors.muted : colors.faint}>
          {on ? `${minutes} min left` : k.status === 'expired' ? 'Expired' : 'Revoked'}
        </Txt>
      </View>
      {on ? (
        <>
          <View style={styles.row}>
            <Txt mono size={15}>
              {fmtEth(left)} left
            </Txt>
            <Txt mono size={12} color={colors.muted}>
              of {fmtEth(k.cap)}
            </Txt>
          </View>
          <LedBar ratio={ratio} height={6} />
        </>
      ) : (
        <Txt mono size={12} color={colors.faint}>
          spent {fmtEth(k.spent)} of {fmtEth(k.cap)}  {shortAddr(k.address)}
        </Txt>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 2, marginBottom: space.xs },
  earlier: { marginTop: space.m },
  off: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  barRight: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  mark: { letterSpacing: -0.5 },
  more: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line },
  pressed: { opacity: 0.5 },
  top: { marginTop: space.m },
  gap: { gap: space.m },
  account: { marginTop: space.xl, gap: space.xs },
  request: { marginTop: space.l, padding: space.m, gap: 4, borderRadius: radius.m, backgroundColor: colors.panel, borderLeftWidth: 3, borderLeftColor: colors.amber },
  section: { marginTop: space.xl, gap: space.s },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: { backgroundColor: colors.panel, borderRadius: radius.m, padding: space.m, gap: space.s },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  act: { paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 },
  footer: { paddingTop: space.s },
});
