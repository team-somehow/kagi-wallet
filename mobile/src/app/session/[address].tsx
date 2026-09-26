import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Fact } from '../../components/Fact';
import { HoldButton } from '../../components/HoldButton';
import { LedBar } from '../../components/LedBar';
import { fmtEth, useChain } from '../../store/chain';
import * as evm from '../../lib/evm';
import { evmRevokeMessage, phoneOnlySign } from '../../lib/frost';
import { loadShard, rand } from '../../lib/shard';
import { unlockShard } from '../../lib/biometrics';
import { connectionString, loadSessionKey } from '../../lib/session';
import { shortAddr } from '../../lib/format';
import { success, warn } from '../../lib/haptics';
import { colors, radius, space } from '../../theme';

type RevokeState = { phase: 'idle' } | { phase: 'working' } | { phase: 'done'; hash: string } | { phase: 'error'; reason: string };

/** One agent key: what it can still spend, until when, what it did, and a way to cut it off. */
export default function SessionDetail() {
  const { address } = useLocalSearchParams<{ address: string }>();
  const { info, sessions, activity, refresh } = useChain();
  const s = sessions.find((x) => x.address.toLowerCase() === String(address).toLowerCase());
  const [copied, setCopied] = useState(false);
  const [revoke, setRevoke] = useState<RevokeState>({ phase: 'idle' });

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!s || !info?.account) {
    return (
      <Screen>
        <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
        <Txt size={16} color={colors.muted}>
          {info ? 'This key is not on this wallet.' : 'Reading Sepolia'}
        </Txt>
      </Screen>
    );
  }

  const explorer = info.explorer;
  const left = s.cap > s.spent ? s.cap - s.spent : 0n;
  const ratio = s.cap > 0n ? Number(s.spent) / Number(s.cap) : 0;
  const minutes = Math.max(0, Math.round(Number(s.expiry - info.now) / 60));
  const mine = activity.filter((a) => a.agent?.toLowerCase() === s.address.toLowerCase());

  const copy = async () => {
    const k = await loadSessionKey(s.address);
    if (!k) return;
    await Clipboard.setStringAsync(connectionString(k, String(info.account)));
    setCopied(true);
    void success();
    setTimeout(() => setCopied(false), 2500);
  };

  // Revoking needs only the phone's share: cutting access off must never wait on the stick.
  const doRevoke = async () => {
    setRevoke({ phase: 'working' });
    try {
      const u = await unlockShard(`Revoke ${s.name}'s key`);
      if (!u.ok) throw new Error(u.reason);
      const shard = await loadShard();
      if (!shard) throw new Error('This phone has no shard.');
      const i = (await refresh()) ?? info;
      const sig = phoneOnlySign(shard, evmRevokeMessage(i.chainId, String(i.account), i.nonce, s.address), rand);
      const r = await evm.revoke(i.account as `0x${string}`, s.address as `0x${string}`, sig);
      if (r.status !== 'success') throw new Error(`The revoke reverted in ${r.hash}.`);
      setRevoke({ phase: 'done', hash: String(r.hash) });
      void success();
      void refresh();
    } catch (e) {
      setRevoke({ phase: 'error', reason: e instanceof Error ? e.message : 'The revoke did not go through.' });
      void warn();
    }
  };

  const statusText = s.status === 'active' ? `${minutes} min left` : s.status === 'expired' ? 'Expired' : 'Revoked';

  return (
    <Screen
      scroll
      footer={
        s.status === 'active' && revoke.phase !== 'done' ? (
          <View style={styles.footer}>
            {revoke.phase === 'working' ? (
              <Txt size={14} color={colors.muted} align="center">
                Revoking on Sepolia
              </Txt>
            ) : (
              <HoldButton label="Hold to revoke this key" onComplete={() => void doRevoke()} />
            )}
          </View>
        ) : null
      }
    >
      <TopBar title="Agent key" left={{ label: 'Close', onPress: () => router.back() }} />
      <View style={styles.gap}>
        <View style={styles.row}>
          <Txt size={28} weight="bold">
            {s.name}
          </Txt>
          <Txt size={14} color={s.status === 'active' ? colors.muted : colors.red}>
            {statusText}
          </Txt>
        </View>

        <View style={styles.card}>
          <Txt size={13} color={colors.muted}>
            {s.status === 'active' ? 'Can still spend' : 'Could have spent'}
          </Txt>
          <Txt mono size={30} weight="bold" color={s.status !== 'active' ? colors.faint : ratio >= 0.8 ? colors.amber : colors.text}>
            {fmtEth(s.status === 'active' ? left : 0n)}
          </Txt>
          <LedBar ratio={ratio} />
          <Fact label="Spent" value={fmtEth(s.spent)} />
          <Fact label="Total allowance" value={fmtEth(s.cap)} />
          <Pressable onPress={() => void Linking.openURL(`${explorer}/address/${s.address}`)}>
            <Fact label="Key" value={shortAddr(s.address)} />
          </Pressable>
        </View>

        {revoke.phase === 'done' ? (
          <View style={styles.card}>
            <Txt size={17} weight="bold">
              Revoked
            </Txt>
            <Txt size={14} color={colors.muted}>
              {s.name} can no longer spend. Your other keys are unchanged.
            </Txt>
            <Button label="View on Etherscan" variant="secondary" onPress={() => void Linking.openURL(`${explorer}/tx/${revoke.hash}`)} />
          </View>
        ) : null}
        {revoke.phase === 'error' ? (
          <Txt size={14} color={colors.red}>
            {revoke.reason}
          </Txt>
        ) : null}

        {s.status === 'active' && s.local ? (
          <View style={styles.gap}>
            <Button label={copied ? 'Copied' : 'Copy session key'} variant="secondary" onPress={() => void copy()} />
            <Txt size={13} color={colors.faint}>
              Paste it into your agent, for example the Leash MCP server. It spends only this allowance.
            </Txt>
          </View>
        ) : null}
        {s.status === 'active' && !s.local ? (
          <Txt size={13} color={colors.faint}>
            This key was made on another device, so it cannot be copied from here.
          </Txt>
        ) : null}

        <Txt size={15} weight="medium" color={colors.muted} style={styles.head}>
          Activity
        </Txt>
        {mine.length === 0 ? (
          <Txt size={14} color={colors.faint}>
            Nothing yet on this phone.
          </Txt>
        ) : (
          mine.map((a) => (
            <Pressable
              key={a.key}
              disabled={!a.hash}
              onPress={() => a.hash && void Linking.openURL(`${explorer}/tx/${a.hash}`)}
              style={({ pressed }) => [styles.act, pressed && styles.pressed]}
            >
              <Txt size={15} color={a.status === 'failed' ? colors.red : colors.text}>
                {a.text}
              </Txt>
              <Txt size={13} color={colors.muted}>
                {a.to ? `to ${shortAddr(a.to)}  ` : ''}
                {new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </Txt>
            </Pressable>
          ))
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.m },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  card: { backgroundColor: colors.panel, borderRadius: radius.m, padding: space.m, gap: space.s },
  head: { marginTop: space.s },
  act: { paddingVertical: space.s, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 },
  pressed: { opacity: 0.5 },
  footer: { paddingTop: space.s },
});
