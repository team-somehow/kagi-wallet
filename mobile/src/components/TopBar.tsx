import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { tap } from '../lib/haptics';
import { Txt } from './Txt';

interface Props {
  title?: string;
  left?: { label: string; onPress: () => void };
  right?: React.ReactNode;
}

export function TopBar({ title, left, right }: Props) {
  return (
    <View style={styles.bar}>
      <View style={styles.side}>
        {left ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={12}
            onPress={() => {
              void tap();
              left.onPress();
            }}
            style={({ pressed }) => pressed && styles.pressed}
          >
            <Txt size={16} color={colors.muted}>
              {left.label}
            </Txt>
          </Pressable>
        ) : null}
      </View>
      {title ? (
        <Txt size={16} weight="medium" align="center" style={styles.title} numberOfLines={1}>
          {title}
        </Txt>
      ) : (
        <View style={styles.title} />
      )}
      <View style={[styles.side, styles.rightSide]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', minHeight: 44, marginBottom: space.m },
  side: { minWidth: 56, flexDirection: 'row', alignItems: 'center' },
  rightSide: { justifyContent: 'flex-end' },
  title: { flex: 1 },
  pressed: { opacity: 0.5 },
});
