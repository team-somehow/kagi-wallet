import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { TopBar } from '../../components/TopBar';
import { Pulse } from '../../components/Pulse';
import { useStore } from '../../store/store';
import { pairingCode } from '../../lib/frost';
import { link } from '../../lib/link';
import { rand } from '../../lib/shard';
import { success, warn } from '../../lib/haptics';
import { colors, space } from '../../theme';

type Phase = 'waiting' | 'code' | 'rejected';

export default function Pair() {
  const { state } = useStore();
  const { wrist } = state;
  const [phase, setPhase] = useState<Phase>('waiting');
  const [code, setCode] = useState('');
  const [wristOk, setWristOk] = useState(false);
  const [phoneOk, setPhoneOk] = useState(false);

  const nonce = useRef('');

  const ask = () => {
    nonce.current = bytesToHex(rand(16));
    link.send({ t: 'pair', nonce: nonce.current });
  };

  // Listen for the wrist's side of pairing for as long as this screen is up.
  useEffect(
    () =>
      link.on((m) => {
        if (m.t === 'pair' && typeof m.nonce === 'string' && nonce.current) {
          setCode(pairingCode(nonce.current, m.nonce));
          setPhase('code');
          void success();
        } else if (m.t === 'pair_ok') {
          setWristOk(true);
        } else if (m.t === 'pair_reject') {
          setPhase('rejected');
          void warn();
        }
      }),
    [],
  );

  useEffect(() => {
    if (wrist.connected) ask();
  }, [wrist.connected]);

  useEffect(() => {
    if (wristOk && phoneOk) router.push('/onboarding/dkg');
  }, [wristOk, phoneOk]);

  const cancel = () => {
    link.send({ t: 'pair_cancel' });
    router.back();
  };

  const retry = () => {
    link.send({ t: 'pair_cancel' });
    setPhase('waiting');
    setWristOk(false);
    setPhoneOk(false);
    ask();
  };

  return (
    <Screen
      footer={
        phase === 'code' ? (
          <>
            <Button label={phoneOk ? 'Waiting for the wrist' : 'It matches'} onPress={() => setPhoneOk(true)} disabled={phoneOk} />
            <Button label="It doesn't match" variant="ghost" onPress={retry} />
          </>
        ) : phase === 'rejected' ? (
          <Button label="Try again" onPress={retry} />
        ) : null
      }
    >
      <TopBar left={{ label: 'Back', onPress: cancel }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        Pair the wrist
      </Txt>
      <Txt size={17} color={colors.muted} style={styles.lead}>
        Plug the wrist into the laptop running the hub and switch it on. Both screens will show the same code.
      </Txt>

      {phase === 'waiting' ? (
        <View style={styles.scan}>
          <Pulse color={wrist.connected ? colors.text : colors.red} size={12} />
          <Txt size={16} color={colors.text}>
            {!wrist.hub ? 'Looking for the hub on this network' : !wrist.connected ? 'The hub is up. Waiting for the wrist.' : 'Asking the wrist for a code'}
          </Txt>
        </View>
      ) : phase === 'rejected' ? (
        <View style={styles.found}>
          <Txt size={17} color={colors.red}>
            You pressed B on the wrist, so it refused to pair.
          </Txt>
        </View>
      ) : (
        <View style={styles.found}>
          <Txt size={15} color={colors.muted}>
            Found {wrist.id ?? 'the wrist'}. It is showing this code too.
          </Txt>
          <Txt mono size={40} weight="bold" lineHeight={48} color={colors.amber}>
            {code}
          </Txt>
          <Txt size={15} color={wristOk ? colors.text : colors.muted}>
            {wristOk ? 'The wrist confirmed.' : 'If it matches, press A on the wrist and tap below.'}
          </Txt>
          {wrist.paired ? (
            <Txt size={15} color={colors.amber}>
              The wrist already holds a shard. Pairing replaces it.
            </Txt>
          ) : null}
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
