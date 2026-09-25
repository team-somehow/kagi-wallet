import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import type { AgentKey } from '../store/types';
import { timeLeft, usdc } from '../lib/format';
import { tap } from '../lib/haptics';
import { LedBar } from './LedBar';
import { Txt } from './Txt';

interface Props {
  k: AgentKey;
  now: number;
  onPress: () => void;
}

export function KeyRow({ k, now, onPress }: Props) {
  const live = k.status === 'live';
  const right = live ? timeLeft(k.expiresAt - now) : k.status;
  const ratio = k.capUsdc > 0 ? k.spentUsdc / k.capUsdc : 0;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void tap();
        onPress();
      }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, !live && styles.dim]}
    >
      <View style={styles.top}>
        <Txt size={17} weight="medium">
          {k.agent}
        </Txt>
        <Txt mono size={13} color={live && ratio >= 0.8 ? colors.amber : colors.muted}>
          {right}
        </Txt>
      </View>
      <Txt mono size={13} color={colors.muted}>
        {usdc(k.spentUsdc)} of {usdc(k.capUsdc)}
      </Txt>
      {live ? (
        <View style={styles.bar}>
          <LedBar ratio={ratio} cells={16} height={6} gap={2} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: space.m, gap: 6, borderBottomWidth: 1, borderBottomColor: colors.line },
  pressed: { opacity: 0.6 },
  dim: { opacity: 0.5 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  bar: { marginTop: 4, paddingRight: 1 },
});
