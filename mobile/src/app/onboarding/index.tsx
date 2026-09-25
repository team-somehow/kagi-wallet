import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { colors, space } from '../../theme';

const LADDER: { who: string; what: string }[] = [
  { who: 'agent', what: 'Spends on its own under a cap you set. Nobody in the loop.' },
  { who: 'phone + wrist', what: 'Anything over the cap needs your face and a press on your wrist.' },
  { who: 'vault', what: 'Anything bigger needs a device at home that only light can reach.' },
];

export default function Welcome() {
  return (
    <Screen footer={<Button label="Create wallet" onPress={() => router.push('/onboarding/secure')} />}>
      <View style={styles.hero}>
        <Txt size={64} weight="bold" lineHeight={64} style={styles.mark}>
          Leash
        </Txt>
        <Txt size={18} color={colors.muted} style={styles.tag}>
          A wallet your agents can spend from, on a leash you hold.
        </Txt>
      </View>
      <View style={styles.ladder}>
        {LADDER.map((r, i) => (
          <View key={r.who} style={[styles.rung, { marginLeft: i * space.l }]}>
            <Txt mono size={13} color={colors.amber}>
              {r.who}
            </Txt>
            <Txt size={16} color={colors.text}>
              {r.what}
            </Txt>
          </View>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { marginTop: space.xxl, gap: space.m },
  mark: { letterSpacing: -2 },
  tag: { maxWidth: 300 },
  ladder: { marginTop: space.xxl, gap: space.l },
  rung: { gap: 4, borderLeftWidth: 1, borderLeftColor: colors.line, paddingLeft: space.m },
});
