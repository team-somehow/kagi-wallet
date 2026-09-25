import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { useExposure, useStore } from '../store/store';
import { colors, space } from '../theme';

/** Stand-in for the agent, the chain and the wrist, until the real ones are wired up. */
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
        Everything here pretends to be something outside the phone.
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
          Wrist
        </Txt>
        <Button
          label={state.wrist.onArm ? 'Take it off the arm' : 'Put it back on'}
          variant="secondary"
          onPress={() => sim.wristOnArm(!state.wrist.onArm)}
        />
        <Button
          label={state.wrist.connected ? 'Drop the connection' : 'Reconnect'}
          variant="secondary"
          onPress={() => sim.wristConnected(!state.wrist.connected)}
        />
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
          label="Wipe and start over"
          variant="danger"
          onPress={() => {
            sim.reset();
            router.dismissAll();
            router.replace('/onboarding');
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
