import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius } from '../theme';
import type { Wrist } from '../store/types';
import { Txt } from './Txt';

export function WristChip({ wrist }: { wrist: Wrist }) {
  const status = !wrist.connected
    ? { text: 'Wrist offline', color: colors.red }
    : !wrist.onArm
      ? { text: 'Wrist off the arm', color: colors.amber }
      : { text: 'On wrist', color: colors.text };
  return (
    <View style={styles.chip}>
      <View style={[styles.dot, { backgroundColor: status.color }]} />
      <Txt size={13} weight="medium" color={status.color}>
        {status.text}
      </Txt>
      <Txt mono size={12} color={colors.muted}>
        {wrist.battery}%
      </Txt>
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
