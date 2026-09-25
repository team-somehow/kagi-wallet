import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { Txt } from './Txt';

interface Props {
  label: string;
  value: string;
  mono?: boolean;
  color?: string;
}

/** One label, one value, on a line. Stack them for a spec sheet. */
export function Fact({ label, value, mono = true, color = colors.text }: Props) {
  return (
    <View style={styles.row}>
      <Txt size={15} color={colors.muted}>
        {label}
      </Txt>
      <Txt mono={mono} size={mono ? 14 : 15} color={color} style={styles.value} align="right">
        {value}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space.m,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  value: { flexShrink: 1 },
});
