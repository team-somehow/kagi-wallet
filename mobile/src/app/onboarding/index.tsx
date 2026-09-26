import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { SpatialDevices } from '../../components/SpatialDevices';
import { colors, radius, space } from '../../theme';

// The spending ladder, one rung per step up in who has to agree. Amber marks a human.
const LADDER: { who: string; when: string; what: string; human: boolean }[] = [
  { who: 'Agent', when: 'Under the cap', what: 'Spends on its own. Nobody in the loop.', human: false },
  { who: 'Phone + wrist', when: 'Over the cap', what: 'Unlock your phone, then hold A on your wrist.', human: true },
  { who: 'Second stick', when: 'Optional', what: 'Add it later. Higher limits then need all three, over infrared.', human: true },
];

export default function Welcome() {
  return (
    <Screen
      scroll
      footer={
        <>
          <Txt size={13} color={colors.faint} style={styles.need}>
            Keep your Kagi stick nearby. Setup takes about a minute.
          </Txt>
          <Button label="Create wallet" onPress={() => router.push('/onboarding/connect')} />
        </>
      }
    >
      <View style={styles.brand}>
        <Txt size={20} weight="bold" style={styles.mark}>
          Kagi
        </Txt>
        <Txt mono size={11} color={colors.faint}>
          THRESHOLD WALLET
        </Txt>
      </View>

      <SpatialDevices two value="Kagi" detail="Your approval device" />

      <View style={styles.hero}>
        <Txt size={34} weight="bold" lineHeight={38} style={styles.headline}>
          Give your agent a spending key.
        </Txt>
        <Txt size={34} weight="bold" lineHeight={38} color={colors.faint} style={styles.headline}>
          Keep the wallet.
        </Txt>
      </View>

      <View style={styles.ladder}>
        {LADDER.map((r, i) => (
          <View key={r.who} style={styles.rung}>
            <View style={styles.rail}>
              <View style={[styles.dot, r.human ? styles.dotHuman : null]}>
                <Txt mono size={11} color={r.human ? colors.amberInk : colors.text}>
                  {i + 1}
                </Txt>
              </View>
              {i < LADDER.length - 1 ? <View style={styles.line} /> : null}
            </View>
            <View style={[styles.body, i === LADDER.length - 1 ? styles.bodyLast : null]}>
              <View style={styles.head}>
                <Txt size={16} weight="medium">
                  {r.who}
                </Txt>
                <Txt mono size={11} color={r.human ? colors.amber : colors.muted}>
                  {r.when.toUpperCase()}
                </Txt>
              </View>
              <Txt size={14} color={colors.muted} lineHeight={20}>
                {r.what}
              </Txt>
            </View>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const DOT = 26;

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: space.m },
  mark: { letterSpacing: -0.5 },
  hero: { marginTop: space.s },
  headline: { letterSpacing: -1 },
  ladder: { marginTop: space.xl, marginBottom: space.l, backgroundColor: colors.panel, borderRadius: radius.m, padding: space.m },
  rung: { flexDirection: 'row', gap: space.m },
  rail: { width: DOT, alignItems: 'center' },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.raised,
  },
  dotHuman: { backgroundColor: colors.amber },
  line: { flex: 1, width: 1, backgroundColor: colors.line, marginVertical: space.xs },
  body: { flex: 1, gap: 4, paddingBottom: space.l },
  bodyLast: { paddingBottom: 0 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s, minHeight: DOT },
  need: { textAlign: 'center' },
});
