import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { colors, fonts, radius } from '../theme';
import { Txt } from './Txt';

export type Beam = 'off' | 'out' | 'back' | 'lost';
export type Link = 'off' | 'searching' | 'on';

interface Props {
  /** Bluetooth from the phone to the wrist and to the second stick. */
  wrist: Link;
  stick: Link;
  /** Infrared between the sticks: light going out to the second stick, coming back, or lost. */
  beam: Beam;
  /** Lights a device while it waits on a person. */
  focus?: 'phone' | 'wrist' | 'stick' | null;
  /** When the three are joined, one ring closes around them. */
  joined?: boolean;
  wristLabel?: string;
  stickLabel?: string;
}

const W = 300;
const H = 190;
// Phone at the top, the two sticks below it, facing each other.
const PHONE = { x: W / 2, y: 34 };
const WRIST = { x: 58, y: 138 };
const STICK = { x: W - 58, y: 138 };

/** A dot that travels a straight line, over and over. */
function Traveler({ from, to, color, delay, duration, size = 6 }: { from: { x: number; y: number }; to: { x: number; y: number }; color: string; delay: number; duration: number; size?: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      p.value = 0.5;
      return;
    }
    p.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.quad) }), -1, false));
    return () => cancelAnimation(p);
  }, [delay, duration, p, reduce]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: from.x + (to.x - from.x) * p.value - size / 2 },
      { translateY: from.y + (to.y - from.y) * p.value - size / 2 },
      { scale: interpolate(p.value, [0, 0.5, 1], [0.6, 1.2, 0.6]) },
    ],
  }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

/** A thin line between two points, drawn as a rotated view. */
function Line({ a, b, color, dashed }: { a: { x: number; y: number }; b: { x: number; y: number }; color: string; dashed?: boolean }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: (a.x + b.x) / 2 - len / 2,
        top: (a.y + b.y) / 2 - 0.75,
        width: len,
        height: 0,
        borderTopWidth: 1.5,
        borderColor: color,
        borderStyle: dashed ? 'dashed' : 'solid',
        transform: [{ rotate: `${ang}rad` }],
      }}
    />
  );
}

/** A soft ring that breathes around whatever is waiting on you. */
function Halo({ at, color, w, h }: { at: { x: number; y: number }; color: string; w: number; h: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    p.value = withRepeat(withSequence(withTiming(1, { duration: 700 }), withTiming(0, { duration: 700 })), -1, false);
    return () => cancelAnimation(p);
  }, [p, reduce]);
  const style = useAnimatedStyle(() => ({ opacity: 0.25 + 0.55 * p.value, transform: [{ scale: 1 + 0.08 * p.value }] }));
  return <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: at.x - w / 2 - 8, top: at.y - h / 2 - 8, width: w + 16, height: h + 16, borderRadius: 16, borderWidth: 2, borderColor: color }, style]} />;
}

/** Light leaving one stick for the other: arcs that grow as they travel. */
function IrWaves({ from, to, color }: { from: { x: number; y: number }; to: { x: number; y: number }; color: string }) {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <Traveler key={i} from={from} to={to} color={color} delay={i * 220} duration={900} size={9} />
      ))}
    </>
  );
}

function Device({ at, kind, label, dim }: { at: { x: number; y: number }; kind: 'phone' | 'stick'; label: string; dim?: boolean }) {
  const w = kind === 'phone' ? 34 : 70;
  const h = kind === 'phone' ? 54 : 38;
  return (
    <View style={{ position: 'absolute', left: at.x - w / 2, top: at.y - h / 2, alignItems: 'center', opacity: dim ? 0.35 : 1 }}>
      <View style={[styles.device, { width: w, height: h }]}>
        <View style={[styles.screen, kind === 'phone' ? { width: w - 8, height: h - 12 } : { width: w - 22, height: h - 12, marginRight: 10 }]} />
        {kind === 'stick' ? <View style={styles.button} /> : null}
      </View>
      <Txt size={11} color={colors.muted} style={styles.label}>
        {label}
      </Txt>
    </View>
  );
}

/**
 * The three devices that hold the wallet key, and what is moving between them: Bluetooth from
 * the phone to each stick, infrared from stick to stick.
 */
export function Trio({ wrist, stick, beam, focus = null, joined = false, wristLabel = 'Wrist', stickLabel = '2nd stick' }: Props) {
  const lineColor = (l: Link) => (l === 'on' ? colors.muted : colors.line);
  const beamColor = beam === 'lost' ? colors.red : colors.amber;
  const mid = { x: (WRIST.x + STICK.x) / 2, y: WRIST.y };
  return (
    <View style={styles.wrap}>
      <View style={{ width: W, height: H }}>
        {joined ? <View pointerEvents="none" style={styles.ring} /> : null}
        <Line a={PHONE} b={WRIST} color={lineColor(wrist)} dashed={wrist !== 'on'} />
        <Line a={PHONE} b={STICK} color={lineColor(stick)} dashed={stick !== 'on'} />
        {beam !== 'off' ? <Line a={{ x: WRIST.x + 36, y: WRIST.y }} b={{ x: STICK.x - 36, y: STICK.y }} color={beam === 'lost' ? colors.red : colors.amberInk} /> : null}
        {wrist === 'searching' ? <Traveler from={PHONE} to={WRIST} color={colors.faint} delay={0} duration={1200} size={5} /> : null}
        {stick === 'searching' ? <Traveler from={PHONE} to={STICK} color={colors.faint} delay={300} duration={1200} size={5} /> : null}
        {beam === 'out' ? <IrWaves from={{ x: WRIST.x + 36, y: WRIST.y }} to={{ x: STICK.x - 36, y: STICK.y }} color={beamColor} /> : null}
        {beam === 'back' ? <IrWaves from={{ x: STICK.x - 36, y: STICK.y }} to={{ x: WRIST.x + 36, y: WRIST.y }} color={beamColor} /> : null}
        {beam === 'lost' ? (
          <View style={[styles.lost, { left: mid.x - 60, top: mid.y - 30 }]}>
            <Txt size={11} color={colors.red} align="center">
              {"Can't read. Face them."}
            </Txt>
          </View>
        ) : null}
        {focus === 'phone' ? <Halo at={PHONE} color={colors.amber} w={34} h={54} /> : null}
        {focus === 'wrist' ? <Halo at={WRIST} color={colors.amber} w={70} h={38} /> : null}
        {focus === 'stick' ? <Halo at={STICK} color={colors.amber} w={70} h={38} /> : null}
        <Device at={PHONE} kind="phone" label="Phone" />
        <Device at={WRIST} kind="stick" label={wristLabel} dim={wrist === 'off'} />
        <Device at={STICK} kind="stick" label={stickLabel} dim={stick === 'off' && beam === 'off'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  device: { borderWidth: 1.5, borderColor: colors.text, borderRadius: radius.m, backgroundColor: colors.panel, alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  screen: { backgroundColor: colors.raised, borderRadius: 3 },
  button: { position: 'absolute', right: 5, width: 5, height: 14, borderRadius: 2, backgroundColor: colors.amber },
  label: { marginTop: 6, fontFamily: fonts.sans },
  ring: { position: 'absolute', left: 14, top: 4, right: 14, bottom: 4, borderRadius: 40, borderWidth: 1, borderColor: colors.amber, opacity: 0.5 },
  lost: { position: 'absolute', width: 120, paddingVertical: 4, borderRadius: 8, backgroundColor: colors.redInk },
});
