import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { colors, radius } from '../theme';
import { thud, warn } from '../lib/haptics';
import { Txt } from './Txt';

interface Props {
  label: string;
  onComplete: () => void;
  durationMs?: number;
  disabled?: boolean;
}

/** Press and hold. The fill is the countdown. Releasing early cancels. */
export function HoldButton({ label, onComplete, durationMs = 1400, disabled }: Props) {
  const progress = useSharedValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);

  const start = () => {
    if (disabled) return;
    setHolding(true);
    void thud();
    progress.value = withTiming(1, { duration: durationMs, easing: Easing.linear });
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      void warn();
      onComplete();
      progress.value = 0;
    }, durationMs);
  };

  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      progress.value = withTiming(0, { duration: 180 });
    }
    setHolding(false);
  };

  const fillStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Press and hold"
      disabled={disabled}
      onPressIn={start}
      onPressOut={cancel}
      style={[styles.base, disabled && styles.off]}
    >
      <Animated.View style={[styles.fill, fillStyle]} />
      <View style={styles.inner}>
        <Txt size={16} weight="medium" color={holding ? colors.text : colors.red}>
          {holding ? 'Keep holding' : label}
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
    borderColor: colors.red,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  off: { opacity: 0.35 },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.red },
  inner: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
});
