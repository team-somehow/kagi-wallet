import React, { useEffect } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
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
import { BRAND, colors } from '../theme';
import { Txt } from './Txt';

type Point = { x: number; y: number };
// The case's extruded edge, stepped toward the bottom right like the logo.
const DEPTH = [10, 8, 6, 4, 2];
export type DeviceBeam = 'off' | 'out' | 'back' | 'lost';

const CASE = {
  blue: { face: '#0061DA', depth: '#01347D', accent: colors.blue, button: ['#83CEFD', '#32A4FE'] },
  red: { face: '#C92A43', depth: '#65101F', accent: '#AA3448', button: ['#FFC2C9', '#FF6B7D'] },
} as const;

/** The standby screen: the Kagi Wallet lockup from the app icon. */
function Lockup() {
  return (
    <View style={s.lockup}>
      <Text allowFontScaling={false} style={s.kanji}>
        鍵
      </Text>
      <View style={s.rule} />
      <View>
        <Txt size={17} weight="bold" lineHeight={19} style={s.word}>
          Kagi
        </Txt>
        <Txt size={17} weight="bold" lineHeight={19} color={BRAND.wallet} style={s.word}>
          Wallet
        </Txt>
      </View>
    </View>
  );
}

/** Decorative only: approvals always happen on the physical hardware. Without a value it shows the standby lockup. */
export function StickModel({
  title = 'WRIST',
  value,
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
  const c = CASE[variant];
  return (
    <View
      accessible
      accessibilityLabel={value === undefined ? `${title}: Kagi Wallet. ${detail}` : `${title}: ${value}. ${detail}`}
      style={{ width, height: 114 * k }}
    >
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
        {DEPTH.map((d) => (
          <View key={d} style={[s.depth, { backgroundColor: c.depth, left: d, top: d * 0.9 }]} />
        ))}
        <View style={[s.case, { backgroundColor: c.face }]}>
          {/* The screen matches the firmware's light mode: aluminium, ink, the role's accent. */}
          <LinearGradient colors={['#F8FAFC', '#E4EBF2']} style={s.lcd}>
            {value === undefined ? (
              <Lockup />
            ) : (
              <>
                <Txt size={9} mono color={c.accent}>
                  {title}
                </Txt>
                <Txt size={value.length > 15 ? 12 : 17} mono color={colors.text} numberOfLines={2}>
                  {value}
                </Txt>
                <Txt size={9} color={colors.muted} numberOfLines={1}>
                  {detail}
                </Txt>
                <View style={[s.bar, active && { backgroundColor: c.accent }]} />
              </>
            )}
          </LinearGradient>
          <View style={[s.buttonHalo, active && [s.buttonActive, { shadowColor: c.accent }]]}>
            <View style={s.button}>
              <View style={[s.half, { backgroundColor: c.button[0] }]} />
              <View style={[s.half, { backgroundColor: c.button[1] }]} />
            </View>
          </View>
        </View>
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
  value,
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
              (focus === 'wrist' ? 'HOLD A TO APPROVE' : connected ? 'Connected by BLE' : 'Waiting for connection')
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
              detail={focus === 'stick' ? 'HOLD A TO APPROVE' : 'Infrared approval'}
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
  depth: { position: 'absolute', width: 210, height: 100, borderRadius: 14 },
  case: {
    width: 210,
    height: 100,
    borderRadius: 14,
    padding: 13,
    paddingRight: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 12,
  },
  lcd: { width: 142, alignSelf: 'stretch', borderRadius: 7, padding: 7, gap: 1, justifyContent: 'center' },
  bar: { height: 1, marginTop: 3, backgroundColor: colors.line },
  lockup: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  kanji: { fontSize: 38, lineHeight: 46, fontWeight: '700', color: BRAND.case },
  rule: { width: 1.5, height: 36, borderRadius: 1, backgroundColor: colors.line },
  word: { letterSpacing: -0.4 },
  buttonHalo: { width: 32, height: 32, borderRadius: 16 },
  buttonActive: { shadowRadius: 10, shadowOpacity: 0.95, shadowOffset: { width: 0, height: 0 } },
  button: { flex: 1, flexDirection: 'row', borderRadius: 16, overflow: 'hidden' },
  half: { flex: 1 },
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
