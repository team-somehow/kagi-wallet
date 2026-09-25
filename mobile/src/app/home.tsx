import React, { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { HoldButton } from '../components/HoldButton';
import { LedBar } from '../components/LedBar';
import { WristChip } from '../components/WristChip';
import { useStore } from '../store/store';
import { fmtEth, useChain } from '../store/chain';
import { chatUrl, link, type Msg } from '../lib/link';
import { loadSessionKey } from '../lib/session';
import { loadShard } from '../lib/shard';
import { phoneKey } from '../lib/frost';
import { shortAddr } from '../lib/format';
import { success, tap, warn } from '../lib/haptics';
import { revokeAllOnChain } from '../lib/chainRevoke';
import { colors, radius, space } from '../theme';

const FUND = 50_000_000_000_000n; // 0.00005 ETH

/** The wallet at a glance: the account, the agent's access, and what it did. */
export default function Home() {
  const { state } = useStore();
  const { info, hubUp, error, primary, activity, limits, refresh } = useChain();
  const [copied, setCopied] = useState(false);
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
      const r = await link.request<Msg>({ t: 'evm_deploy', groupKey: s.groupKey, phoneKey: phoneKey(s), fund: FUND.toString() }, 200000);
      if (r.t === 'evm_error') throw new Error(String(r.reason));
      void success();
      await refresh();
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : 'Could not reach Sepolia.');
      void warn();
    } finally {
      setDeploying(false);
    }
  };

  const copy = async () => {
    if (!primary) return;
    const k = await loadSessionKey(primary.address);
    if (!k) return;
    await Clipboard.setStringAsync(k.privateKey);
    setCopied(true);
    void success();
    setTimeout(() => setCopied(false), 2500);
  };

  const revokeAll = () => {
    void revokeAllOnChain(state.address).then(() => refresh());
  };

  const left = primary ? (primary.cap > primary.spent ? primary.cap - primary.spent : 0n) : 0n;
  const ratio = primary && primary.cap > 0n ? Number(primary.spent) / Number(primary.cap) : 0;
  const minutes = primary && info ? Math.max(0, Math.round(Number(primary.expiry - info.now) / 60)) : 0;

  return (
    <Screen
      scroll
      footer={
        primary ? (
          <View style={styles.footer}>
            <HoldButton label="Hold to revoke agent access" onComplete={revokeAll} />
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

      {!hubUp ? (
        <Txt size={14} color={colors.red} style={styles.top}>
          Not connected to the hub. Showing the last known state.
        </Txt>
      ) : error && !info ? (
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
          {primary ? (
            <View style={styles.card}>
              <View style={styles.row}>
                <Txt size={18} weight="medium">
                  {primary.name}
                </Txt>
                <Txt size={13} color={colors.muted}>
                  {minutes} min left
                </Txt>
              </View>
              <Txt mono size={28} weight="bold" color={ratio >= 0.8 ? colors.amber : colors.text}>
                {fmtEth(left)}
              </Txt>
              <LedBar ratio={ratio} />
              <Txt mono size={13} color={colors.muted}>
                {fmtEth(primary.spent)} spent of {fmtEth(primary.cap)}
              </Txt>
              {primary.local ? (
                <>
                  <Button label={copied ? 'Copied' : 'Copy session key'} variant="secondary" onPress={() => void copy()} />
                  <Txt size={13} color={colors.faint}>
                    Paste it into the agent chat at {chatUrl()}
                  </Txt>
                </>
              ) : null}
            </View>
          ) : (
            <View style={styles.card}>
              <Txt size={16} color={colors.faint}>
                No agent can spend. Give one a key with a total allowance and an expiry.
              </Txt>
              <Button label="Give an agent a key" onPress={() => router.push('/agent')} />
            </View>
          )}
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

const styles = StyleSheet.create({
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
