import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { useExposure, useStore } from '../store/store';
import { link } from '../lib/link';
import { deleteShard } from '../lib/shard';
import { colors, space } from '../theme';

/** Stand-in for the agent and the chain. The wrist is real. */
export default function Demo() {
  const { state, sim } = useStore();
  const { live } = useExposure();
  const noKeys = live.length === 0;

  const then = (fn: () => void, delay = 350) => () => {
    router.back();
    setTimeout(fn, delay);
  };

  return (
    <Screen scroll>
      <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        Demo controls
      </Txt>
      <Txt size={15} color={colors.muted} style={styles.lead}>
        These pretend to be the agent and the chain. The wrist is the real one on your arm.
      </Txt>

      <View style={styles.group}>
        <Txt size={15} weight="medium" color={colors.muted}>
          Agent
        </Txt>
        <Button label="Ask for a $500 key" variant="secondary" onPress={then(() => sim.requestKey(undefined, 500, 24))} />
        <Button label="Spend a little" variant="secondary" disabled={noKeys} onPress={() => sim.spend()} />
        <Button label="Try to spend over the cap" variant="secondary" disabled={noKeys} onPress={then(() => sim.overCap())} />
        <View style={styles.toggle}>
          <View style={styles.toggleText}>
            <Txt size={16}>Keep spending on its own</Txt>
            <Txt size={13} color={colors.muted}>
              A small spend every few seconds while a key is live
            </Txt>
          </View>
          <Switch
            value={state.autopilot}
            disabled={noKeys}
            onValueChange={sim.autopilot}
            trackColor={{ true: colors.amber, false: colors.line }}
            thumbColor={colors.text}
          />
        </View>
      </View>

      <View style={styles.group}>
        <Txt size={15} weight="medium" color={colors.muted}>
          Chain
        </Txt>
        <Button label="Sepolia testnet" variant="secondary" onPress={() => router.push('/chain')} />
      </View>

      <View style={styles.group}>
        <Txt size={15} weight="medium" color={colors.muted}>
          Clock
        </Txt>
        <Button label="Expire the soonest key" variant="secondary" disabled={noKeys} onPress={sim.expireSoonest} />
      </View>

      <View style={styles.group}>
        <Txt size={15} weight="medium" color={colors.muted}>
          Wallet
        </Txt>
        <Button
          label="Wipe phone and wrist, start over"
          variant="danger"
          onPress={() => {
            link.send({ t: 'wipe' });
            void deleteShard().then(() => {
              sim.reset();
              router.dismissAll();
              router.replace('/onboarding');
            });
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.s },
  group: { marginTop: space.xl, gap: space.s },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space.m, paddingVertical: space.s },
  toggleText: { flex: 1, gap: 2 },
});
