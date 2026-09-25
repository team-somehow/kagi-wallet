import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../theme';

function Ring({ delay }: { delay: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2400, easing: Easing.out(Easing.quad) }), -1, false));
    return () => cancelAnimation(p);
  }, [delay, p, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: 0.8 * (1 - p.value), transform: [{ scale: 0.2 + p.value }] }));
  return <Animated.View style={[styles.ring, style]} />;
}

/** Signal rings, the same as the stick shows while it waits. */
export function Radar() {
  return (
    <View style={styles.wrap}>
      <Ring delay={0} />
      <Ring delay={800} />
      <Ring delay={1600} />
      <View style={styles.dot} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 180, height: 180, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' },
  ring: { position: 'absolute', width: 180, height: 180, borderRadius: 90, borderWidth: 2, borderColor: colors.text },
  dot: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.amber },
});
