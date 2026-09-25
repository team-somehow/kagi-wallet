import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { unlockShard } from '../lib/biometrics';
import { buzz, success } from '../lib/haptics';
import type { Wrist } from '../store/types';
import { Button } from './Button';
import { Steps, type Step } from './Steps';
import { Txt } from './Txt';

export type Phase = 'idle' | 'unlocking' | 'wrist' | 'done' | 'error';

interface Props {
  /** What the primary button says before anything has happened. */
  action: string;
  /** Shown under the phone step. */
  phoneDetail: string;
  wrist: Wrist;
  onPhoneSigned?: () => void;
  onDone: () => void;
  /** Milliseconds until the simulated wrist press. Real hardware replaces this. */
  wristDelayMs?: number;
}

/**
 * The manager key is 2-of-2: phone shard, then wrist shard.
 * Biometrics release the phone's partial signature. A press on the wrist
 * releases the other half. Nothing is signed until both happen.
 */
export function ManagerSign({ action, phoneDetail, wrist, onPhoneSigned, onDone, wristDelayMs = 2800 }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wristReady = wrist.connected && wrist.onArm;

  const finish = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setPhase('done');
    void success();
    onDone();
  };

  useEffect(() => {
    if (phase !== 'wrist' || !wristReady) return;
    void buzz();
    timer.current = setTimeout(finish, wristDelayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, wristReady]);

  const unlock = async () => {
    setError(null);
    setPhase('unlocking');
    const r = await unlockShard(action);
    if (!r.ok) {
      setError(r.reason);
      setPhase('error');
      return;
    }
    onPhoneSigned?.();
    setPhase('wrist');
  };

  const phoneState: Step['state'] =
    phase === 'idle' ? 'todo' : phase === 'unlocking' ? 'active' : phase === 'error' ? 'failed' : 'done';
  const wristState: Step['state'] = phase === 'wrist' ? 'active' : phase === 'done' ? 'done' : 'todo';

  const steps: Step[] = [
    {
      label: 'Phone shard',
      detail: phase === 'error' && error ? error : phase === 'idle' || phase === 'unlocking' ? phoneDetail : 'Signed from the secure keystore',
      state: phoneState,
    },
    {
      label: 'Wrist shard',
      detail: !wristReady
        ? wrist.connected
          ? 'The wrist is off your arm. Put it on to wake the shard.'
          : 'The wrist is offline. Bring it within range.'
        : phase === 'wrist'
          ? 'It buzzed. Press A on the wrist.'
          : phase === 'done'
            ? 'Pressed. Both halves signed.'
            : 'Press A on the wrist when it buzzes',
      state: wristState,
    },
  ];

  return (
    <View style={styles.wrap}>
      <Steps steps={steps} />
      {phase === 'idle' || phase === 'error' || phase === 'unlocking' ? (
        <Button
          label={phase === 'error' ? 'Try again' : action}
          variant="amber"
          onPress={() => void unlock()}
          loading={phase === 'unlocking'}
        />
      ) : null}
      {phase === 'wrist' ? (
        <View style={styles.waiting}>
          <Txt size={14} color={colors.muted} align="center">
            {wristReady ? 'Waiting for the wrist' : 'Paused until the wrist is back'}
          </Txt>
          {wristReady ? <Button label="Simulate the press" variant="ghost" onPress={finish} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.m },
  waiting: { gap: space.xs, alignItems: 'center' },
});
