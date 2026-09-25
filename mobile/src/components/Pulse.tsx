import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../theme';

interface Props {
  color?: string;
  size?: number;
  active?: boolean;
}

/** A breathing dot. Means "waiting on something outside this phone". */
export function Pulse({ color = colors.amber, size = 10, active = true }: Props) {
  const reduce = useReducedMotion();
  const v = useSharedValue(1);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(v);
      v.value = withTiming(1, { duration: 150 });
      return;
    }
    v.value = withRepeat(
      withSequence(
        withTiming(0.25, { duration: 650, easing: Easing.inOut(Easing.quad) }),
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.quad) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(v);
  }, [active, reduce, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  return <Animated.View style={[styles.dot, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({ dot: {} });
