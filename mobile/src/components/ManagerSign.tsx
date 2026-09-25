import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { unlockShard } from '../lib/biometrics';
import { success, warn } from '../lib/haptics';
import { combine, evmMessage, grantCanonical, messageFor, nonces, txCanonical } from '../lib/frost';
import { link, type Msg } from '../lib/link';
import { loadShard, rand } from '../lib/shard';
import { uid } from '../store/mock';
import { useStore } from '../store/store';
import { Button } from './Button';
import { Steps, type Step } from './Steps';
import { Txt } from './Txt';
import { wristStatus } from './WristChip';

export type SignPayload =
  | { kind: 'grant'; agent: string; pubkey: string; capUsdc: number; hours: number }
  | { kind: 'tx'; agent: string; contract: string; calldata: string }
  | { kind: 'evm'; agent: string; chainId: number; account: string; nonce: bigint; to: string; value: bigint; data: string };

type Phase = 'idle' | 'unlocking' | 'wrist' | 'combining' | 'done' | 'error';

interface Props {
  action: string;
  phoneDetail: string;
  payload: SignPayload;
  onPhoneSigned?: () => void;
  /** Called with the verified 64 byte BIP340 signature, hex. */
  onDone: (signature: string) => void;
}

const PHONE_ERRORS = ['Cancelled', 'Could not verify you. Try again.', 'This phone has no shard. Create the wallet again.'];

const REJECT_TEXT: Record<string, string> = {
  user: 'You rejected it on the wrist.',
  timeout: 'The wrist timed out. Nothing was signed.',
  off_arm: 'The wrist is off your arm. Put it on and try again.',
  not_paired: 'The wrist has no shard. Pair it again from a fresh wallet.',
  busy: 'The wrist is showing another request. Finish that one first.',
  bad_calldata: 'The wrist could not read this transaction, so it refused.',
};

/**
 * The manager key is 2 of 2: phone shard, then wrist shard.
 * Biometrics unlock the phone's share. The wrist shows what it is signing, decoded
 * from the raw bytes, and signs its half only when you press A. The phone checks
 * the wrist's half and the final signature before anything counts as signed.
 */
export function ManagerSign({ action, phoneDetail, payload, onPhoneSigned, onDone }: Props) {
  const { state } = useStore();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const pendingId = useRef<string | null>(null);
  const status = wristStatus(state.wrist, state.address);

  // Leaving the screen mid-request clears it off the wrist.
  useEffect(
    () => () => {
      if (pendingId.current) link.send({ t: 'sign_cancel', id: pendingId.current });
    },
    [],
  );

  const fail = (msg: string) => {
    pendingId.current = null;
    setError(msg);
    setPhase('error');
    void warn();
  };

  const run = async () => {
    setError(null);
    setPhase('unlocking');
    const unlocked = await unlockShard(action);
    if (!unlocked.ok) return fail(unlocked.reason);
    const shard = await loadShard();
    if (!shard) return fail('This phone has no shard. Create the wallet again.');

    const m =
      payload.kind === 'evm'
        ? evmMessage(payload)
        : messageFor(
            payload.kind === 'grant'
              ? grantCanonical(payload.agent, payload.pubkey, payload.capUsdc, payload.hours)
              : txCanonical(payload.contract, payload.calldata),
          );
    const mine = nonces(rand);
    const id = uid();
    pendingId.current = id;
    onPhoneSigned?.();
    setPhase('wrist');

    const answer = link.waitFor(
      (x: Msg) => (x.t === 'sig_share' || x.t === 'sign_reject') && x.id === id,
      75000,
    );
    const wire =
      payload.kind === 'evm'
        ? {
            kind: 'evm',
            agent: payload.agent,
            chainId: String(payload.chainId),
            account: payload.account,
            nonce: payload.nonce.toString(),
            to: payload.to,
            value: payload.value.toString(),
            data: payload.data,
          }
        : payload.kind === 'grant'
        ? {
            kind: 'grant',
            agent: payload.agent,
            pubkey: payload.pubkey,
            capMicro: String(Math.round(payload.capUsdc * 1_000_000)),
            hours: payload.hours,
          }
        : { kind: 'tx', agent: payload.agent, to: payload.contract, calldata: payload.calldata };
    if (!link.send({ t: 'sign', id, ...wire, D: mine.D, E: mine.E })) return fail('Lost the hub. Nothing was signed.');

    let reply: Msg;
    try {
      reply = await answer;
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'No answer from the wrist.');
    }
    pendingId.current = null;
    if (reply.t === 'sign_reject') return fail(REJECT_TEXT[String(reply.reason)] ?? `The wrist refused: ${String(reply.reason)}.`);

    setPhase('combining');
    // Let the spinner paint before the curve math blocks the JS thread.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const signature = combine(shard, m, mine, { D2: String(reply.D), E2: String(reply.E), z2: String(reply.z) });
      setSig(signature);
      setPhase('done');
      void success();
      onDone(signature);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'The signature did not verify.');
    }
  };

  const phoneFailed = phase === 'error' && phaseBeforeWrist(error);
  const wristFailed = phase === 'error' && !phoneFailed;
  const phoneState: Step['state'] =
    phase === 'idle' ? 'todo' : phase === 'unlocking' ? 'active' : phoneFailed ? 'failed' : 'done';
  const wristState: Step['state'] =
    phase === 'wrist' || phase === 'combining' ? 'active' : phase === 'done' ? 'done' : wristFailed ? 'failed' : 'todo';

  const phoneText =
    phoneFailed && error ? error : phase === 'idle' || phase === 'unlocking' ? phoneDetail : 'Unlocked from the secure keystore';
  const wristText = wristFailed
    ? (error ?? 'Something went wrong.')
    : phase === 'wrist'
      ? 'It buzzed. Check the amount on the wrist, then press A to sign or B to reject.'
      : phase === 'combining'
        ? 'Pressed. Checking both halves.'
        : phase === 'done' && sig
          ? `Signature ${sig.slice(0, 8)}…${sig.slice(-8)} verified`
          : !status.ok
            ? `${status.text}.`
            : 'Press A on the wrist when it buzzes';

  const steps: Step[] = [
    { label: 'Phone shard', detail: phoneText, state: phoneState },
    { label: 'Wrist shard', detail: wristText, state: wristState },
  ];

  return (
    <View style={styles.wrap}>
      <Steps steps={steps} />
      {phase === 'idle' || phase === 'error' || phase === 'unlocking' ? (
        <Button
          label={phase === 'error' ? 'Try again' : action}
          variant="amber"
          onPress={() => void run()}
          loading={phase === 'unlocking'}
          disabled={!status.ok}
        />
      ) : null}
      {phase === 'wrist' ? (
        <Txt size={14} color={colors.muted} align="center">
          Waiting for the wrist
        </Txt>
      ) : null}
    </View>
  );
}

// Errors raised before anything reached the wrist belong on the phone step.
function phaseBeforeWrist(error: string | null): boolean {
  return error !== null && PHONE_ERRORS.includes(error);
}

const styles = StyleSheet.create({
  wrap: { gap: space.m },
});
