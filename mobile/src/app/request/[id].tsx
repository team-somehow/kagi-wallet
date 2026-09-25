import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { TopBar } from '../../components/TopBar';
import { Fact } from '../../components/Fact';
import { ManagerSign } from '../../components/ManagerSign';
import { useStore } from '../../store/store';
import { makeKey } from '../../store/mock';
import { hours, shortAddr, usdc } from '../../lib/format';
import { colors, space } from '../../theme';

export default function Request() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch } = useStore();
  const req = state.requests.find((r) => r.id === id);
  const [issued, setIssued] = useState(false);

  if (!req) {
    return (
      <Screen>
        <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
        <Txt size={17} color={colors.muted}>
          This request is gone.
        </Txt>
      </Screen>
    );
  }

  const approve = () => {
    const key = makeKey(req.agent, req.capUsdc, req.durationH, req.pubkey);
    dispatch({ type: 'GRANT_DECIDE', id: req.id, status: 'approved', key });
    setIssued(true);
  };

  const deny = () => {
    dispatch({ type: 'GRANT_DECIDE', id: req.id, status: 'denied' });
    router.back();
  };

  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      footer={
        issued ? (
          <Button label="Done" onPress={() => router.back()} />
        ) : (
          <Button label="Deny" variant="ghost" onPress={deny} />
        )
      }
    >
      <TopBar left={issued ? undefined : { label: 'Close', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        {issued ? 'Key issued' : `${req.agent} wants a key`}
      </Txt>
      <Txt size={17} color={colors.muted} style={styles.lead}>
        {issued
          ? `${req.agent} can spend up to ${usdc(req.capUsdc)} for the next ${hours(req.durationH)} without asking. Over that, the wrist buzzes.`
          : 'The agent made its own keypair. You are deciding how much it may spend before you hear about it.'}
      </Txt>

      <View style={styles.facts}>
        <Fact label="Cap" value={`${usdc(req.capUsdc)} USDC`} color={colors.amber} />
        <Fact label="Lives for" value={hours(req.durationH)} mono={false} />
        <Fact label="Agent key" value={shortAddr(req.pubkey, 10, 6)} />
        <Fact label="Counts as spend" value="outflow, approvals, gas" mono={false} />
        <Fact label="Cannot" value="add owners, swap validators, upgrade" mono={false} />
      </View>

      {!issued ? (
        <View style={styles.sign}>
          <ManagerSign
            action="Approve and sign"
            phoneDetail="Unlock to sign the grant with the phone shard"
            payload={{ kind: 'grant', agent: req.agent, pubkey: req.pubkey, capUsdc: req.capUsdc, hours: req.durationH }}
            onDone={approve}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.m },
  facts: { marginTop: space.l },
  sign: { marginTop: space.xl },
});
