import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { LedBar } from '../components/LedBar';
import { useStore } from '../store/store';
import { colors, space } from '../theme';

export default function Revoked() {
  const { state } = useStore();
  const count = state.keys.filter((k) => k.status === 'revoked').length;
  return (
    <Screen footer={<Button label="Back to wallet" onPress={() => router.back()} />}>
      <View style={styles.body}>
        <Txt size={32} weight="bold" lineHeight={36} color={colors.red}>
          Every key is revoked
        </Txt>
        <View style={styles.bar}>
          <LedBar ratio={0} />
        </View>
        <Txt size={17} color={colors.text}>
          {count === 1 ? 'One key' : `${count} keys`} went dead on chain. No agent can move anything from this wallet
          until you issue a new key.
        </Txt>
        <Txt size={17} color={colors.muted}>
          Your phone did that alone. Any single shard can revoke. It takes both to grant.
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: space.xxl, gap: space.l },
  bar: { paddingRight: 1 },
});
