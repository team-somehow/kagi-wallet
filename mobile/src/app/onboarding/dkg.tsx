import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Steps, type Step } from '../../components/Steps';
import { useStore } from '../../store/store';
import { makeAddress } from '../../store/mock';
import { groupAddr } from '../../lib/format';
import { success, tap } from '../../lib/haptics';
import { colors, space } from '../../theme';

const ROUNDS = [
  { label: 'Commitments exchanged', detail: 'Each device commits to its share before revealing anything' },
  { label: 'Shares delivered', detail: 'Encrypted to the other device, over the paired channel' },
  { label: 'Shares verified', detail: 'Each side checks the other against its commitment' },
  { label: 'Address derived', detail: 'Same public key on both screens, no private key anywhere' },
];

export default function Dkg() {
  const { dispatch } = useStore();
  const [done, setDone] = useState(0);
  const [address] = useState(makeAddress);
  const finished = done >= ROUNDS.length;

  useEffect(() => {
    if (finished) {
      void success();
      return;
    }
    const t = setTimeout(() => {
      void tap();
      setDone((d) => d + 1);
    }, 900);
    return () => clearTimeout(t);
  }, [done, finished]);

  const steps: Step[] = ROUNDS.map((r, i) => ({
    ...r,
    state: i < done ? 'done' : i === done ? 'active' : 'todo',
  }));

  const confirm = () => {
    dispatch({ type: 'ONBOARDED', address });
    router.replace('/home');
  };

  return (
    <Screen
      footer={
        finished ? (
          <>
            <Button label="Same address on the wrist" onPress={confirm} />
            <Button label="Different address" variant="ghost" onPress={() => router.back()} />
          </>
        ) : null
      }
    >
      <View style={styles.top}>
        <Txt size={32} weight="bold" lineHeight={36}>
          {finished ? 'Wallet created' : 'Generating the key'}
        </Txt>
        <Txt size={17} color={colors.muted}>
          {finished
            ? 'Check the wrist. It should be showing exactly this.'
            : 'Phone and wrist are building one key between them. Keep the wrist awake.'}
        </Txt>
      </View>
      {finished ? (
        <View style={styles.address}>
          <Txt mono size={22} lineHeight={34} color={colors.text}>
            {groupAddr(address)}
          </Txt>
          <Txt size={14} color={colors.muted}>
            Root key, 2 of 2. You can add the vault later to make it 3 of 3.
          </Txt>
        </View>
      ) : (
        <View style={styles.steps}>
          <Steps steps={steps} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: { marginTop: space.xl, gap: space.m },
  steps: { marginTop: space.xl },
  address: { marginTop: space.xl, gap: space.m },
});
