import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { TopBar } from '../../components/TopBar';
import { biometricsAvailable, unlockShard } from '../../lib/biometrics';
import { colors, space } from '../../theme';

export default function Secure() {
  const [bio, setBio] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void biometricsAvailable().then(setBio);
  }, []);

  const lock = async () => {
    setBusy(true);
    setError(null);
    const r = await unlockShard('Lock the phone shard');
    setBusy(false);
    if (!r.ok) {
      setError(r.reason);
      return;
    }
    router.push('/onboarding/pair');
  };

  return (
    <Screen
      footer={
        <>
          {error ? (
            <Txt size={14} color={colors.red} align="center">
              {error}
            </Txt>
          ) : null}
          <Button
            label={bio === false ? 'Continue with device passcode' : 'Lock with biometrics'}
            onPress={() => void lock()}
            loading={busy}
          />
        </>
      }
    >
      <TopBar left={{ label: 'Back', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        Your phone holds one shard of two
      </Txt>
      <View style={styles.body}>
        <Txt size={17} color={colors.text}>
          The wallet key is never in one place. Your phone keeps half inside its secure keystore, and it only comes out
          to sign when you unlock it.
        </Txt>
        <Txt size={17} color={colors.muted}>
          The other half lives on the wrist. Neither half can sign anything on its own.
        </Txt>
        {bio === false ? (
          <Txt size={15} color={colors.amber}>
            No biometrics are set up on this device. The shard will unlock with the device passcode instead.
          </Txt>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: space.l, gap: space.m },
});
