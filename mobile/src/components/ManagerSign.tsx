import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, space } from '../theme';
import { unlockShard } from '../lib/biometrics';
import { tap, warn } from '../lib/haptics';
import {
  combine,
  evmGrantMessage,
  evmLimitMessage,
  evmMessage,
  grantCanonical,
  messageFor,
  nonces,
  txCanonical,
} from '../lib/frost';
import { link, type Msg } from '../lib/link';
import { loadRoot, loadShard, rand } from '../lib/shard';
import { combineRoot, partial, rootNonces, type RootShare } from '../lib/root';
import { fmtAmount } from '../store/chain';
import { Trio, type Beam } from './Trio';
import { uid } from '../store/mock';
import { useStore } from '../store/store';
import { Button } from './Button';
import { Steps, type Step } from './Steps';
import { Txt } from './Txt';
import { wristStatus } from './WristChip';

export type SignPayload =
  | { kind: 'grant'; agent: string; pubkey: string; capUsdc: number; hours: number }
  | { kind: 'tx'; agent: string; contract: string; calldata: string }
  | {
      kind: 'evm';
      agent: string;
      chainId: number;
      account: string;
      nonce: bigint;
      to: string;
      value: bigint;
      data: string;
    }
  | {
      kind: 'evm_grant';
      agent: string;
      chainId: number;
      account: string;
      nonce: bigint;
      agentAddress: string;
      cap: bigint;
      expiry: bigint;
    }
  | {
      kind: 'evm_limit';
      agent: string;
      chainId: number;
      account: string;
      nonce: bigint;
      agentAddress: string;
      oldCap: bigint;
      newCap: bigint;
      expiry: bigint;
    };

type Phase = 'idle' | 'unlocking' | 'wrist' | 'ir_out' | 'stick' | 'ir_back' | 'retry' | 'combining' | 'done' | 'error';

interface Props {
  action: string;
  /** The button that starts signing. Defaults to "Unlock phone". */
  startLabel?: string;
  phoneDetail: string;
  payload: SignPayload;
  onPhoneSigned?: () => void;
  /** Start as soon as the screen shows, for requests the owner is already expecting. */
  autoStart?: boolean;
  /** The owner declined on the wrist (B, or the hold timed out). */
  onReject?: (reason: string) => void;
  /** Called with the verified 64 byte BIP340 signature, hex. */
  onDone: (signature: string) => void;
}

const PHONE_ERRORS = [
  'Cancelled',
  'Could not verify you. Try again.',
  'This phone has no shard. Create the wallet again.',
];

const REJECT_TEXT: Record<string, string> = {
  user: 'You rejected it on the wrist.',
  timeout: 'The wrist timed out. Nothing was signed.',
  off_arm: 'The wrist is off your arm. Put it on and try again.',
  not_paired: 'The wrist has no shard. Pair it again from a fresh wallet.',
  busy: 'The wrist is showing another request. Finish that one first.',
  bad_calldata: 'The wrist could not read this transaction, so it refused.',
  // With the second stick
  ir_failed: 'The sticks could not see each other. Face them, at least 30 cm apart, and try again.',
  vault_rejected: 'You said no on the second stick. Nothing was signed.',
  vault_timeout: 'The second stick did not answer. Face the sticks and try again.',
  root_not_3_of_3: 'The wrist is not set up with a second stick yet.',
  nothing_to_retry: 'The wrist no longer has this request. Start over.',
  expired: 'The request waited too long and was dropped. Start over.',
  needs_second_stick: 'This wallet needs both sticks now.',
};

/**
 * The manager key is 2 of 2: phone shard, then wrist shard.
 * Biometrics unlock the phone's share. The wrist shows what it is signing, decoded
 * from the raw bytes, and signs its half only when you hold its button. The phone checks
 * the wrist's half and the final signature before anything counts as signed.
 */
export function ManagerSign({ action, startLabel, phoneDetail, payload, onPhoneSigned, onReject, onDone, autoStart }: Props) {
  const { state } = useStore();
  const [phase, setPhase] = useState<Phase>('idle');
  // With a second stick the wallet key is 3 of 3, and the wrist asks it over infrared.
  const [three, setThree] = useState<RootShare | null>(null);
  const [lostAt, setLostAt] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    void loadRoot().then((r) => setThree(r && r.parties === 3 && r.groupKey === state.address ? r : null));
  }, [state.address]);
  useEffect(() => {
    if (!lostAt) return;
    const t = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(t);
  }, [lostAt]);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const pendingId = useRef<string | null>(null);
  const status = wristStatus(state.wrist, state.address);

  // Leaving the screen mid-request clears it off the wrist.
  useEffect(
    () => () => {
      if (pendingId.current) {
        link.send({ t: 'sign_cancel', id: pendingId.current });
        link.send({ t: 'root_cancel', id: pendingId.current });
      }
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
        : payload.kind === 'evm_grant'
          ? evmGrantMessage({ ...payload, agent: payload.agentAddress })
          : payload.kind === 'evm_limit'
            ? evmLimitMessage({ ...payload, agent: payload.agentAddress })
            : messageFor(
                payload.kind === 'grant'
                  ? grantCanonical(payload.agent, payload.pubkey, payload.capUsdc, payload.hours)
                  : txCanonical(payload.contract, payload.calldata),
              );
    const root = await loadRoot();
    if (root && root.parties === 3 && root.groupKey === shard.groupKey && payload.kind.startsWith('evm'))
      return runThree(root, m);

    const mine = nonces(rand);
    const id = uid();
    pendingId.current = id;
    onPhoneSigned?.();
    setPhase('wrist');

    const answer = link.waitFor((x: Msg) => (x.t === 'sig_share' || x.t === 'sign_reject') && x.id === id, 75000);
    const wire =
      payload.kind === 'evm_limit'
        ? {
            kind: 'evm_limit',
            agent: payload.agent,
            chainId: String(payload.chainId),
            account: payload.account,
            nonce: payload.nonce.toString(),
            agentAddress: payload.agentAddress,
            oldCap: payload.oldCap.toString(),
            newCap: payload.newCap.toString(),
            expiry: payload.expiry.toString(),
          }
        : payload.kind === 'evm_grant'
          ? {
              kind: 'evm_grant',
              agent: payload.agent,
              chainId: String(payload.chainId),
              account: payload.account,
              nonce: payload.nonce.toString(),
              agentAddress: payload.agentAddress,
              cap: payload.cap.toString(),
              expiry: payload.expiry.toString(),
            }
          : payload.kind === 'evm'
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
    if (!link.send({ t: 'sign', id, ...wire, D: mine.D, E: mine.E }))
      return fail('Lost the wrist connection. Nothing was signed.');

    let reply: Msg;
    try {
      reply = await answer;
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'No answer from the wrist.');
    }
    pendingId.current = null;
    if (reply.t === 'sign_reject') {
      onReject?.(String(reply.reason));
      return fail(REJECT_TEXT[String(reply.reason)] ?? `The wrist refused: ${String(reply.reason)}.`);
    }

    setPhase('combining');
    // Let the spinner paint before the curve math blocks the JS thread.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const signature = combine(shard, m, mine, { D2: String(reply.D), E2: String(reply.E), z2: String(reply.z) });
      setSig(signature);
      setPhase('done');
      void tap();
      onDone(signature);
    } catch (e) {
      fail(e instanceof Error ? e.message : 'The signature did not verify.');
    }
  };

  // Phone, then wrist, then the second stick over infrared, then back. Every part is checked.
  // If the infrared leg fails, the job is paused on the wrist and on the phone, and a retry
  // sends it again: no new fingerprint, no new press on the wrist.
  const job = useRef<{
    id: string;
    n1: ReturnType<typeof rootNonces>;
    m: Uint8Array;
    root: RootShare;
    off: () => void;
  } | null>(null);

  const endJob = () => {
    job.current?.off();
    job.current = null;
    pendingId.current = null;
  };

  const waitThree = async () => {
    const j = job.current;
    if (!j) return;
    let reply: Msg;
    try {
      reply = await link.waitFor(
        (x: Msg) => (x.t === 'root_share' || x.t === 'sign_reject' || x.t === 'root_stalled') && x.id === j.id,
        300000,
        'the sticks',
      );
    } catch {
      setError('No answer from the sticks. Face them and retry.');
      setPhase('retry');
      void warn();
      return;
    }
    if (job.current !== j) return;
    if (reply.t === 'root_stalled') {
      setError(REJECT_TEXT[String(reply.reason)] ?? 'The infrared step did not finish.');
      setPhase('retry');
      void warn();
      return;
    }
    if (reply.t === 'sign_reject') {
      endJob();
      onReject?.(String(reply.reason) === 'vault_rejected' ? 'user' : String(reply.reason));
      return fail(REJECT_TEXT[String(reply.reason)] ?? `Refused: ${String(reply.reason)}.`);
    }
    setPhase('combining');
    await new Promise((r) => setTimeout(r, 30));
    try {
      const cs = [
        { id: 1, D: j.n1.D, E: j.n1.E },
        { id: 2, D: String(reply.D2), E: String(reply.E2) },
        { id: 3, D: String(reply.D3), E: String(reply.E3) },
      ];
      const z1 = partial(j.root.share, j.root.groupKey, j.m, cs, 1, j.n1);
      const signature = combineRoot(j.root, j.m, cs, { 1: z1, 2: String(reply.z2), 3: String(reply.z3) });
      endJob();
      setSig(signature);
      setPhase('done');
      void tap();
      onDone(signature);
    } catch (e) {
      endJob();
      fail(e instanceof Error ? e.message : 'The signature did not verify.');
    }
  };

  const runThree = async (root: RootShare, m: Uint8Array) => {
    if (payload.kind === 'evm' && payload.data !== '0x')
      return fail('With two sticks, the wallet only signs plain transfers here.');
    job.current?.off();
    const n1 = rootNonces(rand);
    const id = uid();
    pendingId.current = id;
    onPhoneSigned?.();
    setLostAt(0);
    setError(null);
    setPhase('wrist');
    const off = link.on((x: Msg) => {
      if (x.t !== 'root_progress' || x.id !== id) return;
      if (x.step === 'ir_to_vault') setPhase('ir_out');
      if (x.step === 'vault_prompted') setPhase('stick');
      if (x.step === 'ir_from_vault') setPhase('ir_back');
      if (x.step === 'ir_miss') setLostAt(Date.now());
    });
    job.current = { id, n1, m, root, off };
    const base = {
      chainId: String((payload as { chainId: number }).chainId),
      account: (payload as { account: string }).account,
      nonce: (payload as { nonce: bigint }).nonce.toString(),
    };
    const wire =
      payload.kind === 'evm_limit'
        ? {
            kind: 'evm_limit',
            agent: payload.agent,
            ...base,
            agentAddress: payload.agentAddress,
            oldCap: payload.oldCap.toString(),
            newCap: payload.newCap.toString(),
            expiry: payload.expiry.toString(),
          }
        : payload.kind === 'evm_grant'
          ? {
              kind: 'evm_grant',
              agent: payload.agent,
              ...base,
              agentAddress: payload.agentAddress,
              cap: payload.cap.toString(),
              expiry: payload.expiry.toString(),
            }
          : payload.kind === 'evm'
            ? { kind: 'evm', agent: payload.agent, ...base, to: payload.to, value: payload.value.toString() }
            : null;
    if (!wire || !link.send({ t: 'root_sign', id, ...wire, D: n1.D, E: n1.E })) {
      endJob();
      return fail('The wrist is not connected. Nothing was signed.');
    }
    await waitThree();
  };

  const retryThree = async () => {
    const j = job.current;
    if (!j) return void run();
    setError(null);
    setLostAt(0);
    setPhase('ir_out');
    if (!link.send({ t: 'root_retry', id: j.id })) {
      setError('The wrist is not connected. Reconnect it and retry.');
      setPhase('retry');
      return;
    }
    await waitThree();
  };

  const startOver = () => {
    if (job.current) link.send({ t: 'root_cancel', id: job.current.id });
    endJob();
    void run();
  };

  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || !status.ok) return;
    started.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, status.ok]);

  const phoneFailed = phase === 'error' && phaseBeforeWrist(error);
  const wristFailed = phase === 'error' && !phoneFailed;
  const phoneState: Step['state'] =
    phase === 'idle' ? 'todo' : phase === 'unlocking' ? 'active' : phoneFailed ? 'failed' : 'done';
  const wristState: Step['state'] =
    phase === 'wrist' || (phase === 'combining' && !three)
      ? 'active'
      : phase === 'done' || (three && ['ir_out', 'stick', 'ir_back', 'retry', 'combining'].includes(phase))
        ? 'done'
        : wristFailed
          ? 'failed'
          : 'todo';
  const stickState: Step['state'] =
    phase === 'retry'
      ? 'failed'
      : phase === 'ir_out' || phase === 'stick' || phase === 'ir_back' || phase === 'combining'
        ? 'active'
        : phase === 'done'
          ? 'done'
          : wristFailed
            ? 'failed'
            : 'todo';
  const lost = lostAt > 0 && now - lostAt < 1500;
  const beam: Beam = lost ? 'lost' : phase === 'ir_out' ? 'out' : phase === 'ir_back' ? 'back' : 'off';

  const phoneText =
    phoneFailed && error
      ? error
      : phase === 'idle' || phase === 'unlocking'
        ? phoneDetail
        : 'Unlocked from the secure keystore';
  const wristText =
    wristFailed && !three
      ? (error ?? 'Something went wrong.')
      : three && wristState === 'done' && phase !== 'done'
        ? 'Signed its part and passed it on over infrared'
        : phase === 'wrist'
          ? 'It buzzed. Check the amount on the wrist, then hold its button to sign, or tap it to reject.'
          : phase === 'combining'
            ? 'Pressed. Checking both halves.'
            : phase === 'done' && sig
              ? `Signature ${sig.slice(0, 8)}…${sig.slice(-8)} verified`
              : !status.ok
                ? `${status.text}.`
                : 'Hold the wrist’s button when it chimes';

  const stickText =
    phase === 'retry'
      ? `${error ?? 'The infrared step did not finish.'} Your phone and wrist parts are kept.`
      : wristFailed
        ? (error ?? 'Something went wrong.')
        : lost
          ? "Can't read the other stick. Face them, at least 30 cm apart."
          : phase === 'ir_out'
            ? 'Sending to the second stick over infrared'
            : phase === 'stick'
              ? 'Check the second stick, then hold its button'
              : phase === 'ir_back'
                ? 'Its signature is coming back over infrared'
                : phase === 'combining'
                  ? 'Checking all three parts'
                  : phase === 'done'
                    ? 'All three parts verified'
                    : 'Signs over infrared after the wrist';

  const steps: Step[] = three
    ? [
        { label: 'Phone', detail: phoneText, state: phoneState },
        { label: 'Wrist', detail: wristText, state: wristState },
        { label: 'Second stick', detail: stickText, state: stickState },
      ]
    : [
        { label: 'Phone shard', detail: phoneText, state: phoneState },
        { label: 'Wrist shard', detail: wristText, state: wristState },
      ];
  const focus = phase === 'unlocking' ? 'phone' : phase === 'wrist' ? 'wrist' : phase === 'stick' ? 'stick' : null;

  return (
    <View style={styles.wrap}>
      {phase === 'idle' || phase === 'error' || phase === 'unlocking' ? (
        <Button
          label={phase === 'error' ? 'Try again' : startLabel ?? 'Unlock phone'}
          variant="amber"
          onPress={() => void run()}
          loading={phase === 'unlocking'}
          disabled={!status.ok}
        />
      ) : null}
      <Trio
        two={Boolean(three)}
        wrist={status.ok ? 'on' : 'searching'}
        stick="off"
        beam={beam}
        focus={focus}
        joined={Boolean(three)}
        value={
          payload.kind === 'evm_limit'
            ? `${fmtAmount(payload.oldCap)} → ${fmtAmount(payload.newCap)}`
            : payload.kind === 'evm_grant'
              ? fmtAmount(payload.cap)
              : 'Kagi'
        }
      />
      {phase !== 'idle' ? <Steps steps={steps} /> : null}
      {phase === 'wrist' ? (
        <Txt size={14} color={colors.muted} align="center">
          Waiting for the wrist
        </Txt>
      ) : null}
      {phase === 'retry' ? (
        <View style={styles.retry}>
          <Button label="Retry infrared" variant="amber" onPress={() => void retryThree()} />
          <Button label="Start over" variant="ghost" onPress={startOver} />
        </View>
      ) : null}
      {three && (phase === 'ir_out' || phase === 'stick' || phase === 'ir_back') ? (
        <Txt size={14} color={lost ? colors.red : colors.muted} align="center">
          {lost ? 'The sticks lost each other. It keeps trying.' : 'Keep the sticks facing each other'}
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
  retry: { gap: space.s },
});
