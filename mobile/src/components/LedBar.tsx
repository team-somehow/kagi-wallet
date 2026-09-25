import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';

interface Props {
  /** 0..1+, spent over cap. Values over 1 light everything red. */
  ratio: number;
  cells?: number;
  height?: number;
  warnAt?: number;
  gap?: number;
}

/**
 * A segmented bargraph, the kind you find on a hardware front panel.
 * White while quiet, amber past the warning mark, red once the cap is gone.
 */
export function LedBar({ ratio, cells = 24, height = 14, warnAt = 0.8, gap = 3 }: Props) {
  const clamped = Math.max(0, Math.min(ratio, 1));
  const lit = Math.round(clamped * cells);
  const over = ratio >= 1;
  return (
    <View style={[styles.row, { height, gap }]}>
      {Array.from({ length: cells }, (_, i) => {
        const on = i < lit;
        const past = i / cells >= warnAt;
        const bg = !on ? colors.raised : over ? colors.red : past ? colors.amber : colors.text;
        return <View key={i} style={[styles.cell, { backgroundColor: bg }]} />;
      })}
      <View pointerEvents="none" style={[styles.mark, { left: `${warnAt * 100}%`, height: height + 8 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', width: '100%' },
  cell: { flex: 1, borderRadius: 1.5 },
  mark: { position: 'absolute', top: -4, width: 1, backgroundColor: colors.amber, opacity: 0.9 },
});
