import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme';
import type { Wrist } from '../store/types';
import { wristMatches } from './WristBridge';
import { Txt } from './Txt';

export function wristStatus(wrist: Wrist, address: string | null): { text: string; color: string; ok: boolean } {
  if (!wrist.hub) return { text: 'Hub offline', color: colors.red, ok: false };
  if (!wrist.connected) return { text: 'Wrist offline', color: colors.red, ok: false };
  if (address && !wristMatches(wrist.groupKey, address)) return { text: 'Other wallet', color: colors.red, ok: false };
  if (!wrist.onArm) return { text: 'Off the arm', color: colors.amber, ok: false };
  return { text: 'On wrist', color: colors.text, ok: true };
}

export function WristChip({ wrist, address }: { wrist: Wrist; address: string | null }) {
  const status = wristStatus(wrist, address);
  return (
    <View style={styles.chip}>
      <View style={[styles.dot, { backgroundColor: status.color }]} />
      <Txt size={13} weight="medium" color={status.color}>
        {status.text}
      </Txt>
      {wrist.connected ? (
        <Txt mono size={12} color={colors.muted}>
          {wrist.battery}%
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
