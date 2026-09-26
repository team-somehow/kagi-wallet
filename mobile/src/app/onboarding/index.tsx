import React from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Txt } from '../../components/Txt';
import { StickModel } from '../../components/SpatialDevices';
import { colors, space } from '../../theme';

// The sticks sit on the welcome screen like hardware on a desk.
const paper = colors.ground;
const ink = colors.text;
const slate = colors.muted;
const rule = colors.line;
const signer = colors.amber; // one of your devices signs

// Who has to agree, from the agent alone up to every device. The dots are how many of your
// own devices sign: none, phone and wrist, then all three with the second stick.
const LADDER: { when: string; who: string; signers: number }[] = [
  { when: 'Under the cap', who: 'The agent’s own key', signers: 0 },
  { when: 'Over the cap', who: 'Your phone and wrist', signers: 2 },
  { when: 'Higher limits', who: 'Plus a second stick', signers: 3 },
];

function Signers({ n }: { n: number }) {
  return (
    <View style={styles.dots} accessibilityLabel={n === 0 ? 'none of your devices' : `${n} of your devices`}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.dot, i < n ? styles.dotOn : null]} />
      ))}
    </View>
  );
}

export default function Welcome() {
  const { width } = useWindowDimensions();
  const k = Math.min(1.2, Math.max(0.8, (width - 2 * space.l) / 340));
  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        <Txt size={22} weight="bold" color={ink} style={styles.mark}>
          Kagi
        </Txt>

        <View style={[styles.stage, { height: 200 * k }]} accessibilityLabel="Your wrist stick and a second stick">
          <View style={[styles.at, { left: 204 * k, top: 0 }]}>
            <StickModel width={144 * k} tilt={9} variant="red" title="SECOND STICK" value="Ready" detail="Infrared" />
          </View>
          <View style={[styles.at, { left: 0, top: 84 * k }]}>
            <StickModel width={190 * k} tilt={-6} title="WRIST" value="Kagi" detail="Hold A to approve" />
          </View>
        </View>

        <View style={styles.hero}>
          <Txt size={40} weight="bold" lineHeight={42} color={ink} style={styles.headline}>
            Give your agent a spending key.
          </Txt>
          <Txt size={40} weight="bold" lineHeight={42} color={slate} style={styles.headline}>
            Keep the wallet.
          </Txt>
        </View>

        <View style={styles.ladder}>
          <Txt size={15} weight="medium" color={ink}>
            Who has to agree
          </Txt>
          <View style={styles.rows}>
            {LADDER.map((r) => (
              <View key={r.when} style={styles.row}>
                <Txt size={15} color={ink} style={styles.when}>
                  {r.when}
                </Txt>
                <Signers n={r.signers} />
                <Txt size={15} color={r.signers ? ink : slate} style={styles.who}>
                  {r.who}
                </Txt>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Txt size={14} color={slate} lineHeight={20}>
          Have your wrist stick nearby. It takes a minute.
        </Txt>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/onboarding/connect')}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
        >
          <Txt size={17} weight="medium" color={paper}>
            Create wallet
          </Txt>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: paper },
  body: {
    paddingHorizontal: space.l,
    paddingTop: space.m,
    paddingBottom: space.l,
  },
  mark: { letterSpacing: -0.6 },
  stage: { marginTop: space.l, marginBottom: space.m },
  at: { position: 'absolute' },
  hero: { marginTop: space.s },
  headline: { letterSpacing: -1.6 },
  ladder: { marginTop: space.xl },
  rows: {
    marginTop: space.s,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: rule,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: rule,
  },
  when: { width: 108 },
  who: { flex: 1 },
  dots: { flexDirection: 'row', gap: 5 },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: rule,
  },
  dotOn: { backgroundColor: signer, borderColor: signer },
  footer: {
    paddingHorizontal: space.l,
    paddingTop: space.m,
    paddingBottom: space.s,
    gap: space.m,
    backgroundColor: paper,
  },
  cta: {
    height: 56,
    borderRadius: 28,
    backgroundColor: ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaPressed: { opacity: 0.85 },
});
