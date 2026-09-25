import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { TopBar } from '../../components/TopBar';
import { Pulse } from '../../components/Pulse';
import { useStore } from '../../store/store';
import { randHex } from '../../store/mock';
import { success } from '../../lib/haptics';
import { colors, space } from '../../theme';

type Phase = 'scanning' | 'found';

export default function Pair() {
  const { state } = useStore();
  const [phase, setPhase] = useState<Phase>('scanning');
  const [fingerprint, setFingerprint] = useState('');

  useEffect(() => {
    if (phase !== 'scanning') return;
    const t = setTimeout(() => {
      setFingerprint(`${randHex(4)} ${randHex(4)}`.toUpperCase());
      setPhase('found');
      void success();
    }, 2200);
    return () => clearTimeout(t);
  }, [phase]);

  return (
    <Screen
      footer={
        phase === 'found' ? (
          <>
            <Button label="It matches" onPress={() => router.push('/onboarding/dkg')} />
            <Button label="It doesn't match" variant="ghost" onPress={() => setPhase('scanning')} />
          </>
        ) : null
      }
    >
      <TopBar left={{ label: 'Back', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        Pair the wrist
      </Txt>
      <Txt size={17} color={colors.muted} style={styles.lead}>
        Put it on and hold A until the screen lights up. It only ever talks outward, so your phone has to be the one
        listening.
      </Txt>

      {phase === 'scanning' ? (
        <View style={styles.scan}>
          <Pulse color={colors.text} size={12} />
          <Txt size={16} color={colors.text}>
            Listening for the wrist
          </Txt>
        </View>
      ) : (
        <View style={styles.found}>
          <Txt size={15} color={colors.muted}>
            Found {state.wrist.id}. The wrist is showing this code too.
          </Txt>
          <Txt mono size={40} weight="bold" lineHeight={48} color={colors.amber}>
            {fingerprint}
          </Txt>
          <Txt size={15} color={colors.muted}>
            If the codes differ, something else is on this network. Stop and try again.
          </Txt>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.m },
  scan: { marginTop: space.xxl, flexDirection: 'row', alignItems: 'center', gap: space.m },
  found: { marginTop: space.xxl, gap: space.m },
});
