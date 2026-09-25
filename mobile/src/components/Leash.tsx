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
import { colors, radius } from '../theme';

const SPAN = 150;

function Bead({ delay, back }: { delay: number; back?: boolean }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }), -1, false));
    return () => cancelAnimation(p);
  }, [delay, p, reduce]);
  const style = useAnimatedStyle(() => {
    const x = back ? SPAN * (1 - p.value) : SPAN * p.value;
    const y = (back ? 10 : -10) * Math.sin(p.value * Math.PI);
    return { transform: [{ translateX: x }, { translateY: y }] };
  });
  return <Animated.View style={[styles.bead, back && styles.beadBack, style]} />;
}

/** Phone and stick with a leash of beads running between them while the key is made. */
export function LeashFlow() {
  return (
    <View style={styles.row}>
      <View style={styles.phone}>
        <View style={styles.phoneScreen} />
      </View>
      <View style={styles.track}>
        {[0, 275, 550, 825].map((d) => (
          <Bead key={d} delay={d} />
        ))}
        {[140, 690].map((d) => (
          <Bead key={`b${d}`} delay={d} back />
        ))}
      </View>
      <View style={styles.stick}>
        <View style={styles.stickScreen} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 110 },
  phone: { width: 44, height: 78, borderRadius: 8, borderWidth: 2, borderColor: colors.text, padding: 5 },
  phoneScreen: { flex: 1, borderRadius: 3, backgroundColor: colors.raised },
  track: { width: SPAN + 12, height: 40, justifyContent: 'center' },
  bead: { position: 'absolute', left: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amber },
  beadBack: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.text },
  stick: { width: 70, height: 50, borderRadius: radius.m, borderWidth: 2, borderColor: colors.text, padding: 6 },
  stickScreen: { flex: 1, borderRadius: 3, backgroundColor: colors.raised },
});
