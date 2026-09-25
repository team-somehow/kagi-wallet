import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Steps, type Step } from '../../components/Steps';
import { useStore } from '../../store/store';
import { dkgFinish, dkgStart, type Pop } from '../../lib/frost';
import { link, type Msg } from '../../lib/link';
import { rand, saveShard } from '../../lib/shard';
import { groupAddr } from '../../lib/format';
import { success, tap, warn } from '../../lib/haptics';
import { colors, space } from '../../theme';

const ROUNDS = [
  { label: 'Phone share made', detail: 'Picked on this phone, never leaves it' },
  { label: 'Wrist share made', detail: 'Picked on the wrist, never leaves it' },
  { label: 'Proofs checked', detail: 'Each side proved it holds the share it announced' },
  { label: 'Group key derived', detail: 'One public key from both shares. No private key exists anywhere.' },
];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Dkg() {
  const { dispatch } = useStore();
  const [done, setDone] = useState(0);
  const [groupKey, setGroupKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const finished = groupKey !== null;

  useEffect(() => {
    let alive = true;
    const step = async (n: number) => {
      if (!alive) return;
      setDone(n);
      void tap();
      await wait(250);
    };
    (async () => {
      await wait(200);
      const mine = dkgStart(rand);
      await step(1);
      const reply = link.waitFor((m: Msg) => m.t === 'dkg' || m.t === 'dkg_error', 15000);
      if (!link.send({ t: 'dkg', X: mine.X, pop: mine.pop })) throw new Error('Lost the hub.');
      const m = await reply;
      if (m.t === 'dkg_error') {
        throw new Error(m.reason === 'not_confirmed' ? 'The wrist has not confirmed the code. Go back and pair again.' : 'The wrist rejected the phone proof.');
      }
      await step(2);
      const share = dkgFinish(mine, String(m.X), m.pop as Pop);
      await step(3);
      if (share.groupKey !== String(m.groupKey)) throw new Error('Phone and wrist derived different keys. Start over.');
      await saveShard(share);
      await step(4);
      if (!alive) return;
      setGroupKey(share.groupKey);
      void success();
    })().catch((e: unknown) => {
      if (!alive) return;
      setError(e instanceof Error ? e.message : 'Key generation failed.');
      void warn();
    });
    return () => {
      alive = false;
    };
  }, []);

  const steps: Step[] = ROUNDS.map((r, i) => ({
    ...r,
    state: i < done ? 'done' : i === done ? (error ? 'failed' : 'active') : 'todo',
  }));

  const confirm = () => {
    if (!groupKey) return;
    dispatch({ type: 'ONBOARDED', address: groupKey });
    router.dismissAll();
    router.replace('/home');
  };

  return (
    <Screen
      footer={
        finished ? (
          <>
            <Button label="Same key on the wrist" onPress={confirm} />
            <Button label="Different key" variant="ghost" onPress={() => router.back()} />
          </>
        ) : error ? (
          <Button label="Back to pairing" onPress={() => router.back()} />
        ) : null
      }
    >
      <View style={styles.top}>
        <Txt size={32} weight="bold" lineHeight={36}>
          {finished ? 'Wallet created' : error ? 'Could not create the key' : 'Generating the key'}
        </Txt>
        <Txt size={17} color={error ? colors.red : colors.muted}>
          {finished
            ? 'The wrist is showing the start and end of this key. Check they match.'
            : error ?? 'Phone and wrist are building one key between them. Keep the wrist plugged in.'}
        </Txt>
      </View>
      {finished && groupKey ? (
        <View style={styles.address}>
          <Txt mono size={28} weight="bold" lineHeight={36} color={colors.amber}>
            {groupKey.slice(0, 4)}..{groupKey.slice(-4)}
          </Txt>
          <Txt mono size={15} lineHeight={24} color={colors.muted}>
            {groupAddr(groupKey)}
          </Txt>
          <Txt size={14} color={colors.muted}>
            Manager key, 2 of 2. Phone and wrist each hold one share.
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
