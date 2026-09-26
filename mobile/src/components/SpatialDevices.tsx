import React, { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../theme';
import { Txt } from './Txt';

type Point = { x: number; y: number };
export type DeviceBeam = 'off' | 'out' | 'back' | 'lost';

/** Decorative only: approvals always happen on the physical hardware. */
export function StickModel({
  title = 'WRIST',
  value = 'Kagi',
  detail = 'Your approval device',
  active = false,
  width = 210,
  tilt = -10,
  variant = 'blue',
}: {
  title?: string;
  value?: string;
  detail?: string;
  active?: boolean;
  width?: number;
  tilt?: number;
  variant?: 'blue' | 'red';
}) {
  const k = width / 210;
  return (
    <View accessible accessibilityLabel={`${title}: ${value}. ${detail}`} style={{ width, height: 114 * k }}>
      <View
        style={{
          width: 210,
          height: 100,
          transformOrigin: 'top left',
          transform: [
            { scale: k },
            { perspective: 800 },
            { rotateX: '14deg' },
            { rotateY: '-10deg' },
            { rotateZ: `${tilt}deg` },
          ],
        }}
      >
        <View style={s.depth} />
        <View style={s.port} />
        <LinearGradient
          colors={variant === 'red' ? ['#C26469', '#7C2938', '#401922'] : ['#508BC2', '#23527E', '#142D4A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.case}
        >
          {/* The screen matches the firmware's light mode: aluminium, ink, the role's accent. */}
          <LinearGradient colors={['#F8FAFC', '#E4EBF2']} style={s.lcd}>
            <Txt size={9} mono color={variant === 'red' ? '#AA3448' : colors.blue}>
              {title}
            </Txt>
            <Txt size={value.length > 15 ? 12 : 17} mono color={colors.text} numberOfLines={2}>
              {value}
            </Txt>
            <Txt size={9} color={colors.muted} numberOfLines={1}>
              {detail}
            </Txt>
            <View style={[s.bar, active && { backgroundColor: colors.blue }]} />
          </LinearGradient>
          <View style={[s.buttonHalo, active && s.buttonActive]}>
            <LinearGradient
              colors={variant === 'red' ? ['#D97B82', '#F0BCC0', '#C65F6B'] : ['#4889C1', '#A6D7F6', '#3C83BE']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.button}
            />
          </View>
          <Txt size={7} mono color="#85909C" style={s.brand}>
            ESP32
          </Txt>
        </LinearGradient>
      </View>
    </View>
  );
}

function Arrow({ from, to, active, color = colors.blue }: { from: Point; to: Point; active: boolean; color?: string }) {
  const reduce = useReducedMotion(),
    p = useSharedValue(0);
  const angle = Math.atan2(to.y - from.y, to.x - from.x),
    length = Math.hypot(to.x - from.x, to.y - from.y);
  useEffect(() => {
    p.value = 0.5;
    if (active && !reduce) p.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(p);
  }, [active, p, reduce]);
  const motion = useAnimatedStyle(() => ({
    opacity: active ? 1 : 0.35,
    transform: [
      { translateX: from.x + (to.x - from.x) * p.value - 7 },
      { translateY: from.y + (to.y - from.y) * p.value - 14 },
      { rotate: `${angle}rad` },
    ],
  }));
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessible={false}>
      <View
        style={{
          position: 'absolute',
          left: (from.x + to.x) / 2 - length / 2,
          top: (from.y + to.y) / 2,
          width: length,
          height: 1,
          backgroundColor: color,
          opacity: active ? 0.45 : 0.15,
          transform: [{ rotate: `${angle}rad` }],
        }}
      />
      <Animated.View style={[{ position: 'absolute' }, motion]}>
        <Txt size={25} color={color}>
          ›
        </Txt>
      </Animated.View>
    </View>
  );
}

export function SpatialDevices({
  two = false,
  beam = 'off',
  focus = null,
  connected = true,
  joined = false,
  setup = false,
  value = 'Kagi',
  detail,
}: {
  two?: boolean;
  beam?: DeviceBeam;
  focus?: 'phone' | 'wrist' | 'stick' | null;
  connected?: boolean;
  joined?: boolean;
  setup?: boolean;
  value?: string;
  detail?: string;
}) {
  const { width } = useWindowDimensions();
  const scale = Math.min(1.15, Math.max(0.7, (width - 48) / 320));
  const w = two ? 150 : 224;
  const first = two ? { left: 8, top: 116 } : { left: 50, top: 79 };
  const out = { x: 161, y: 142 },
    back = { x: 200, y: 102 };
  const activeIR = beam === 'out' || beam === 'back';
  return (
    <View
      style={[s.sceneWrap, { height: 244 * scale }]}
      accessibilityLabel={two ? 'Phone, wrist and second stick' : 'Phone and wrist stick'}
    >
      <View style={{ width: 320, height: 244, transform: [{ scale }] }}>
        <View style={s.orbit} />
        <LinearGradient colors={['#B35F1710', '#1C629608', '#E9EDF100']} style={s.glow} />
        <View style={s.phone}>
          <View style={s.phoneIcon} />
          <Txt size={10} color={focus === 'phone' ? colors.amber : colors.muted}>
            {focus === 'phone' ? 'Unlock phone' : 'Your phone'}
          </Txt>
        </View>
        <Arrow
          from={{ x: 160, y: 40 }}
          to={{ x: first.left + w / 2, y: first.top + 10 }}
          active={focus === 'wrist'}
          color={colors.amber}
        />
        {setup ? <Arrow from={{ x: 171, y: 37 }} to={{ x: 234, y: 58 }} active color={colors.blue} /> : null}
        <View style={[s.position, first]}>
          <StickModel
            width={w}
            title="WRIST"
            value={!connected ? 'Reconnect' : beam === 'out' ? 'Sending →' : beam === 'back' ? 'Reading ←' : value}
            detail={
              detail ??
              (focus === 'wrist' ? 'HOLD TO APPROVE' : connected ? 'Connected by BLE' : 'Waiting for connection')
            }
            active={focus === 'wrist'}
          />
        </View>
        {two ? (
          <View style={[s.position, { left: 165, top: 53 }]}>
            <StickModel
              width={145}
              tilt={13}
              variant="red"
              title="SECOND STICK"
              value={
                focus === 'stick'
                  ? value
                  : beam === 'out'
                    ? 'Reading'
                    : beam === 'back'
                      ? 'Signed'
                      : setup
                        ? 'Joining'
                        : joined
                          ? 'IR idle'
                          : 'Ready'
              }
              detail={focus === 'stick' ? 'HOLD TO APPROVE' : 'Infrared approval'}
              active={focus === 'stick'}
            />
          </View>
        ) : null}
        {activeIR ? <Arrow from={beam === 'out' ? out : back} to={beam === 'out' ? back : out} active /> : null}
        <View style={s.caption}>
          <Txt size={11} mono color={beam === 'lost' ? colors.red : activeIR ? colors.blue : colors.muted}>
            {beam === 'lost'
              ? 'Align the sticks · retry IR'
              : setup
                ? 'BLE · sealed shares'
                : activeIR
                  ? beam === 'out'
                    ? 'IR → APPROVAL'
                    : 'IR ← SIGNATURE'
                  : two
                    ? 'ONE WALLET · THREE DEVICES'
                    : 'YOUR KEY · YOUR BOUNDARY'}
          </Txt>
        </View>
      </View>
    </View>
  );
}
const s = StyleSheet.create({
  sceneWrap: { alignItems: 'center', justifyContent: 'center', marginVertical: 4 },
  position: { position: 'absolute' },
  depth: {
    position: 'absolute',
    top: 9,
    left: 0,
    width: 210,
    height: 99,
    borderRadius: 14,
    backgroundColor: '#090D13',
    borderWidth: 1,
    borderColor: '#4D576444',
  },
  port: {
    position: 'absolute',
    right: -10,
    top: 36,
    width: 16,
    height: 23,
    borderRadius: 3,
    backgroundColor: '#8B969F',
  },
  case: {
    width: 210,
    height: 100,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#77828E66',
    padding: 13,
    paddingBottom: 16,
    flexDirection: 'row',
    gap: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 12,
  },
  lcd: { width: 137, borderRadius: 5, borderWidth: 2, borderColor: '#070D14', padding: 6, gap: 1 },
  bar: { height: 1, marginTop: 3, backgroundColor: colors.line },
  buttonHalo: { width: 25, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  buttonActive: {
    shadowColor: colors.blue,
    shadowRadius: 9,
    shadowOpacity: 0.9,
    shadowOffset: { width: 0, height: 0 },
  },
  button: { width: 25, height: 25, borderRadius: 14, borderWidth: 1, borderColor: '#57BEEE55' },
  brand: { position: 'absolute', bottom: 3, left: 17 },
  orbit: {
    position: 'absolute',
    left: 15,
    top: 82,
    width: 285,
    height: 125,
    borderRadius: 145,
    borderWidth: 1,
    borderColor: '#8A939F66',
    transform: [{ rotate: '-16deg' }],
  },
  glow: { position: 'absolute', left: 28, top: 63, width: 260, height: 149, borderRadius: 120 },
  phone: { position: 'absolute', left: 112, top: 9, flexDirection: 'row', alignItems: 'center', gap: 7 },
  phoneIcon: {
    width: 12,
    height: 21,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.muted,
    backgroundColor: colors.raised,
  },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 4, alignItems: 'center' },
});
