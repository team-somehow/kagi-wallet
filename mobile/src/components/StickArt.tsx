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
import { Txt } from './Txt';

/** Chevrons sliding toward the A button, the same animation the stick shows. */
function Chevron({ delay }: { delay: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(p);
  }, [delay, p, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.75 * p.value, transform: [{ translateX: -26 + p.value * 22 }] }));
  return (
    <Animated.View style={[styles.chev, style]}>
      <Txt size={30} weight="bold" color={colors.amber} lineHeight={32}>
        ›
      </Txt>
    </Animated.View>
  );
}

/**
 * The stick as seen lying flat in landscape, with the A button on the right. With `pointToA`
 * the chevrons slide toward A; `pressing` lights the button up.
 */
export function StickArt({ pointToA = false, pressing = false, screen }: { pointToA?: boolean; pressing?: boolean; screen?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <View style={styles.screen}>
          <Txt size={13} weight="medium" color={colors.text} align="center">
            {screen ?? 'Kagi'}
          </Txt>
        </View>
      </View>
      <View style={[styles.button, pressing && styles.buttonOn]}>
        <Txt size={15} weight="bold" color={pressing ? colors.onLight : colors.text}>
          A
        </Txt>
      </View>
      {pointToA ? (
        <View style={styles.arrows} pointerEvents="none">
          <Chevron delay={0} />
          <Chevron delay={300} />
          <Chevron delay={600} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 110 },
  body: {
    width: 170,
    height: 92,
    borderRadius: 14,
    backgroundColor: colors.raised,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 10,
    justifyContent: 'center',
  },
  screen: { flex: 1, borderRadius: 6, backgroundColor: colors.ground, justifyContent: 'center' },
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    marginLeft: -6,
    backgroundColor: colors.raised,
    borderWidth: 2,
    borderColor: colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonOn: { backgroundColor: colors.amber },
  arrows: { position: 'absolute', right: -64, flexDirection: 'row', transform: [{ scaleX: -1 }] },
  chev: { width: 16 },
});
