import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { TopBar } from '../../components/TopBar';
import { Radar } from '../../components/Radar';
import { StickArt } from '../../components/StickArt';
import { LeashFlow } from '../../components/Leash';
import { useStore } from '../../store/store';
import { dkgFinish, dkgStart, phoneKey, type Pop, type Share } from '../../lib/frost';
import { link, type Msg } from '../../lib/link';
import { rand, saveShard } from '../../lib/shard';
import { unlockShard } from '../../lib/biometrics';
import { success, tap, warn } from '../../lib/haptics';
import { colors, space } from '../../theme';

type Phase = 'search' | 'hold' | 'keygen' | 'lock' | 'account' | 'ready' | 'accountError' | 'error';

// Starting balance for the Sepolia account, from the hub's relayer. Tiny: testnet ETH is scarce.
const FUND = 50_000_000_000_000n; // 0.00005 ETH

const COPY: Record<Phase, { title: string; body: string }> = {
  search: { title: 'Wake your stick', body: 'Switch it on and keep it close. The phone finds it over Bluetooth.' },
  hold: { title: 'Press and hold A', body: 'Hold the A button on your stick until its ring fills.' },
  keygen: { title: 'Creating your key', body: 'Phone and stick each make half. Neither side ever holds the whole key.' },
  lock: { title: 'Wallet created', body: 'Last step: lock your half of the key to your fingerprint.' },
  account: { title: 'Creating your account', body: 'Putting your wallet on Sepolia. This takes about 20 seconds.' },
  ready: { title: 'Your wallet is ready', body: 'It holds 0.00005 test ETH on Sepolia. Next, give an agent its own key.' },
  accountError: { title: 'The account is not on Sepolia yet', body: '' },
  error: { title: 'Something went wrong', body: '' },
};

/** Create a wallet with one stick: find it, hold A on it, done. */
export default function Connect() {
  const { state, dispatch } = useStore();
  const [phase, setPhase] = useState<Phase>('search');
  const [error, setError] = useState('');
  const share = useRef<Share | null>(null);
  const started = useRef(false);

  // 1. Once the stick is connected, ask it to pair.
  useEffect(() => {
    if (phase !== 'search' || !state.wrist.connected || started.current) return;
    started.current = true;
    const nonce = bytesToHex(rand(16));
    const reply = link.waitFor((m: Msg) => m.t === 'pair' || m.t === 'pair_reject', 15000, 'the stick');
    // Right after connecting, the stick may not be listening yet: ask a few times.
    let tries = 0;
    const ask = () => {
      link.send({ t: 'pair', nonce });
      if (++tries < 4) resend = setTimeout(ask, 3000);
    };
    let resend: ReturnType<typeof setTimeout> | undefined = setTimeout(ask, 600);
    reply.finally(() => clearTimeout(resend));
    reply
      .then((m) => {
        if (m.t === 'pair_reject') throw new Error('Cancelled on the stick.');
        void tap();
        setPhase('hold');
      })
      .catch((e: unknown) => {
        started.current = false;
        setError(e instanceof Error ? e.message : 'The stick did not answer.');
        setPhase('error');
      });
  }, [phase, state.wrist.connected]);

  // 2. The stick was held: make the key together.
  useEffect(() => {
    if (phase !== 'hold') return;
    const off = link.on((m) => {
      if (m.t === 'pair_reject') {
        setError('Cancelled on the stick.');
        setPhase('error');
        void warn();
      }
      if (m.t !== 'pair_ok') return;
      setPhase('keygen');
      void (async () => {
        try {
          const mine = dkgStart(rand);
          const reply = link.waitFor((x: Msg) => x.t === 'dkg' || x.t === 'dkg_error', 20000, 'the stick');
          link.send({ t: 'dkg', X: mine.X, pop: mine.pop });
          const d = await reply;
          if (d.t === 'dkg_error') throw new Error('The stick could not make its half. Try again.');
          const s = dkgFinish(mine, String(d.X), d.pop as Pop);
          if (s.groupKey !== String(d.groupKey)) throw new Error('Phone and stick disagree on the key. Try again.');
          await saveShard(s);
          share.current = s;
          // Let the animation breathe for a moment; it is the part people watch.
          await new Promise((r) => setTimeout(r, 1200));
          void success();
          setPhase('lock');
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Key creation failed.');
          setPhase('error');
          void warn();
        }
      })();
    });
    return off;
  }, [phase]);

  const finish = async () => {
    const u = await unlockShard('Lock your key to your fingerprint');
    if (!u.ok) return;
    if (!share.current) return;
    dispatch({ type: 'ONBOARDED', address: share.current.groupKey });
    void deploy();
  };

  // 3. Put the wallet on Sepolia in the same journey.
  const deploy = async () => {
    const s = share.current;
    if (!s) return;
    setError('');
    setPhase('account');
    try {
      const info = await link.request<Msg>({ t: 'evm_info?', groupKey: s.groupKey }, 20000);
      if (info.t === 'evm_error') throw new Error(String(info.reason));
      if (!info.account) {
        const r = await link.request<Msg>({ t: 'evm_deploy', groupKey: s.groupKey, phoneKey: phoneKey(s), fund: FUND.toString() }, 200000);
        if (r.t === 'evm_error') throw new Error(String(r.reason));
      }
      void success();
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Sepolia.');
      setPhase('accountError');
      void warn();
    }
  };

  const open = () => {
    router.dismissAll();
    router.replace('/home');
  };

  const retry = () => {
    started.current = false;
    link.send({ t: 'pair_cancel' });
    setError('');
    setPhase('search');
  };

  const c = COPY[phase];
  return (
    <Screen
      footer={
        phase === 'lock' ? (
          <Button label="Lock with fingerprint" onPress={() => void finish()} />
        ) : phase === 'ready' ? (
          <Button label="Open wallet" onPress={open} />
        ) : phase === 'accountError' ? (
          <>
            <Button label="Try again" onPress={() => void deploy()} />
            <Button label="Finish later" variant="ghost" onPress={open} />
          </>
        ) : phase === 'error' ? (
          <Button label="Try again" onPress={retry} />
        ) : null
      }
    >
      <TopBar
        left={phase !== 'search' && phase !== 'hold' && phase !== 'error' ? undefined : { label: 'Back', onPress: () => (link.send({ t: 'pair_cancel' }), router.back()) }}
      />
      <Txt size={32} weight="bold" lineHeight={36}>
        {c.title}
      </Txt>
      <Txt size={17} color={phase === 'error' || phase === 'accountError' ? colors.red : colors.muted} style={styles.body}>
        {phase === 'error' || phase === 'accountError' ? error : c.body}
      </Txt>
      <View style={styles.art}>
        {phase === 'search' ? <Radar /> : null}
        {phase === 'hold' ? <StickArt pointToA screen="Pair with this phone?" /> : null}
        {phase === 'keygen' ? <LeashFlow /> : null}
        {phase === 'lock' || phase === 'accountError' ? <StickArt screen="Wallet ready" /> : null}
        {phase === 'account' ? <LeashFlow /> : null}
        {phase === 'ready' ? <StickArt screen="Wallet ready" /> : null}
      </View>
      {phase === 'search' ? (
        <Txt size={14} color={colors.faint} align="center">
          {state.wrist.connected ? 'Found it. Connecting…' : 'Looking for your Leash stick'}
        </Txt>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { marginTop: space.m },
  art: { marginTop: space.xxl, marginBottom: space.l, alignItems: 'center', justifyContent: 'center', minHeight: 200 },
});
