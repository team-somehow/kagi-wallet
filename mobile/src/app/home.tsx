import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { HoldButton } from '../components/HoldButton';
import { LedBar } from '../components/LedBar';
import { KeyRow } from '../components/KeyRow';
import { WristChip } from '../components/WristChip';
import { useExposure, useStore } from '../store/store';
import { useNow } from '../lib/useNow';
import { hours, usdc } from '../lib/format';
import { tap } from '../lib/haptics';
import { colors, radius, space } from '../theme';

export default function Home() {
  const { state, dispatch } = useStore();
  const { live, cap, spent, ratio } = useExposure();
  const now = useNow(10000);
  const pending = state.requests.filter((r) => r.status === 'pending');
  const earlier = state.keys.filter((k) => k.status !== 'live');
  const hot = ratio >= 0.8;

  const revokeAll = () => {
    dispatch({ type: 'REVOKE_ALL' });
    router.push('/revoke');
  };

  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      footer={
        <View style={styles.footer}>
          <HoldButton label="Hold to revoke every key" onComplete={revokeAll} disabled={live.length === 0} />
        </View>
      }
    >
      <View style={styles.bar}>
        <Txt size={20} weight="bold" style={styles.mark}>
          Leash
        </Txt>
        <View style={styles.barRight}>
          <WristChip wrist={state.wrist} />
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void tap();
              router.push('/demo');
            }}
            style={({ pressed }) => [styles.demo, pressed && styles.pressed]}
          >
            <Txt size={13} weight="medium" color={colors.muted}>
              Demo
            </Txt>
          </Pressable>
        </View>
      </View>

      <View style={styles.exposure}>
        <Txt size={15} color={colors.muted}>
          Agents can still spend
        </Txt>
        <Txt mono size={48} weight="bold" lineHeight={56} color={cap === 0 ? colors.faint : hot ? colors.amber : colors.text}>
          {usdc(Math.max(cap - spent, 0))}
        </Txt>
        <View style={styles.barWrap}>
          <LedBar ratio={ratio} />
        </View>
        <View style={styles.exposureFoot}>
          <Txt mono size={13} color={colors.muted}>
            {usdc(spent)} spent of {usdc(cap)}
          </Txt>
          <Txt mono size={13} color={colors.muted}>
            {live.length} {live.length === 1 ? 'key' : 'keys'}
          </Txt>
        </View>
        <Txt size={14} color={hot ? colors.amber : colors.faint}>
          {cap === 0
            ? 'No live keys. Nothing can leave this wallet until you issue one.'
            : hot
              ? 'Past the 80% mark. The wrist buzzed.'
              : 'Rolling 24 hour window. The wrist buzzes at the amber mark.'}
        </Txt>
      </View>

      {pending.map((r) => (
        <View key={r.id} style={styles.request}>
          <View style={styles.requestText}>
            <Txt size={17} weight="medium">
              {r.agent} asks for a {usdc(r.capUsdc)} key
            </Txt>
            <Txt size={14} color={colors.muted}>
              For {hours(r.durationH)}. It will spend on its own under that cap.
            </Txt>
          </View>
          <Button label="Review" variant="amber" onPress={() => router.push(`/request/${r.id}`)} style={styles.reviewBtn} />
        </View>
      ))}

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Txt size={15} weight="medium" color={colors.muted}>
            Live keys
          </Txt>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              void tap();
              router.push('/issue');
            }}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Txt size={15} weight="medium" color={colors.amber}>
              Issue a key
            </Txt>
          </Pressable>
        </View>
        {live.length === 0 ? (
          <Txt size={16} color={colors.faint} style={styles.empty}>
            None yet. Issue one, or wait for an agent to ask.
          </Txt>
        ) : (
          live.map((k) => <KeyRow key={k.id} k={k} now={now} onPress={() => router.push(`/key/${k.id}`)} />)
        )}
      </View>

      {earlier.length > 0 ? (
        <View style={styles.section}>
          <Txt size={15} weight="medium" color={colors.muted}>
            Earlier
          </Txt>
          {earlier.map((k) => (
            <KeyRow key={k.id} k={k} now={now} onPress={() => router.push(`/key/${k.id}`)} />
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
  demo: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.m, borderWidth: 1, borderColor: colors.line },
  pressed: { opacity: 0.5 },
  exposure: { marginTop: space.xl, gap: space.s },
  barWrap: { marginTop: space.s, paddingRight: 1 },
  exposureFoot: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  request: {
    marginTop: space.l,
    padding: space.m,
    gap: space.m,
    borderRadius: radius.m,
    backgroundColor: colors.panel,
    borderLeftWidth: 3,
    borderLeftColor: colors.amber,
  },
  requestText: { gap: 4 },
  reviewBtn: { minHeight: 44 },
  section: { marginTop: space.xl, gap: 4 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  empty: { paddingVertical: space.m },
  footer: { paddingTop: space.s },
});
