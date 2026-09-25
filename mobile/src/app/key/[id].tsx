import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { TopBar } from '../../components/TopBar';
import { LedBar } from '../../components/LedBar';
import { Fact } from '../../components/Fact';
import { HoldButton } from '../../components/HoldButton';
import { useStore } from '../../store/store';
import { useNow } from '../../lib/useNow';
import { clock, shortAddr, timeLeft, usdc } from '../../lib/format';
import type { Tx } from '../../store/types';
import { colors, space } from '../../theme';

const KIND: Record<Tx['kind'], string> = { transfer: 'Sent', swap: 'Swapped', approve: 'Allowed', call: 'Called' };

function TxRow({ tx }: { tx: Tx }) {
  const rejected = tx.status === 'rejected';
  const cosigned = tx.status === 'co-signed';
  return (
    <View style={styles.tx}>
      <View style={styles.txText}>
        <Txt size={15} color={rejected ? colors.muted : colors.text}>
          {KIND[tx.kind]} to {tx.toLabel}
        </Txt>
        <Txt size={13} color={rejected ? colors.red : cosigned ? colors.amber : colors.faint}>
          {rejected ? 'Over the cap, rejected on chain' : cosigned ? 'Co-signed by you' : clock(tx.at)}
        </Txt>
      </View>
      <Txt mono size={14} color={rejected ? colors.muted : colors.text} style={rejected ? styles.strike : undefined}>
        {usdc(tx.amountUsdc)}
      </Txt>
    </View>
  );
}

export default function KeyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch } = useStore();
  const now = useNow(10000);
  const k = state.keys.find((x) => x.id === id);

  if (!k) {
    return (
      <Screen>
        <TopBar left={{ label: 'Back', onPress: () => router.back() }} />
        <Txt size={17} color={colors.muted}>
          This key is gone.
        </Txt>
      </Screen>
    );
  }

  const live = k.status === 'live';
  const ratio = k.spentUsdc / k.capUsdc;
  const left = Math.max(k.capUsdc - k.spentUsdc, 0);

  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      footer={
        live ? (
          <HoldButton
            label="Hold to revoke this key"
            onComplete={() => {
              dispatch({ type: 'REVOKE_KEY', id: k.id });
            }}
          />
        ) : null
      }
    >
      <TopBar left={{ label: 'Back', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        {k.agent}
      </Txt>
      <Txt mono size={13} color={colors.muted} style={styles.pub}>
        {shortAddr(k.pubkey, 10, 6)}
      </Txt>

      {!live ? (
        <View style={styles.banner}>
          <Txt size={15} color={k.status === 'revoked' ? colors.red : colors.muted}>
            {k.status === 'revoked'
              ? 'Revoked. The agent cannot spend with this key. Issue a new one when you are ready.'
              : 'Expired. Ephemeral keys live 24 hours at most. The agent will ask for a new one.'}
          </Txt>
        </View>
      ) : null}

      <View style={styles.gauge}>
        <Txt
          mono
          size={36}
          weight="bold"
          lineHeight={44}
          color={live ? (ratio >= 0.8 ? colors.amber : colors.text) : colors.faint}
        >
          {usdc(left)}
        </Txt>
        <Txt size={14} color={colors.muted}>
          left of a {usdc(k.capUsdc)} cap
        </Txt>
        <View style={styles.barWrap}>
          <LedBar ratio={ratio} />
        </View>
      </View>

      <View style={styles.facts}>
        <Fact label="Time left" value={live ? timeLeft(k.expiresAt - now) : k.status} />
        <Fact label="Issued" value={clock(k.issuedAt)} />
        <Fact label="Window" value="rolling 24h" />
        <Fact label="Counts as spend" value="outflow, approvals, gas" mono={false} />
        <Fact label="Manager can raise to" value={usdc(k.capUsdc + state.managerRaiseLimit)} />
      </View>

      <View style={styles.section}>
        <Txt size={15} weight="medium" color={colors.muted}>
          Activity
        </Txt>
        {k.txs.length === 0 ? (
          <Txt size={15} color={colors.faint} style={styles.empty}>
            Nothing yet.
          </Txt>
        ) : (
          k.txs.map((tx) => <TxRow key={tx.id} tx={tx} />)
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pub: { marginTop: 4 },
  banner: { marginTop: space.l, padding: space.m, backgroundColor: colors.panel, borderRadius: 8 },
  gauge: { marginTop: space.xl, gap: 4 },
  barWrap: { marginTop: space.m, paddingRight: 1 },
  facts: { marginTop: space.xl },
  section: { marginTop: space.xl, gap: 4 },
  empty: { paddingVertical: space.m },
  tx: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  txText: { flex: 1, gap: 2 },
  strike: { textDecorationLine: 'line-through' },
});
