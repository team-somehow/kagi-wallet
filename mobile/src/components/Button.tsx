import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { colors, radius } from '../theme';
import { tap } from '../lib/haptics';
import { Txt } from './Txt';

export type Variant = 'primary' | 'secondary' | 'amber' | 'danger' | 'ghost';

interface Props {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  haptic?: boolean;
}

const fill: Record<Variant, { bg: string; fg: string; border: string }> = {
  primary: { bg: colors.text, fg: colors.onLight, border: colors.text },
  secondary: { bg: 'transparent', fg: colors.text, border: colors.line },
  amber: { bg: colors.amber, fg: colors.onLight, border: colors.amber },
  danger: { bg: 'transparent', fg: colors.red, border: colors.red },
  ghost: { bg: 'transparent', fg: colors.muted, border: 'transparent' },
};

export function Button({ label, onPress, variant = 'primary', disabled, loading, style, haptic = true }: Props) {
  const c = fill[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off }}
      disabled={off}
      onPress={() => {
        if (haptic) void tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        { backgroundColor: c.bg, borderColor: c.border, opacity: off ? 0.4 : pressed ? 0.7 : 1 },
        variant === 'ghost' && styles.ghost,
        style,
      ]}
    >
      <View style={styles.inner}>
        {loading ? <ActivityIndicator color={c.fg} /> : null}
        <Txt size={16} weight="medium" color={c.fg}>
          {label}
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    borderRadius: radius.m,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  ghost: { minHeight: 44 },
  inner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
});
