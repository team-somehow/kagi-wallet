import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { Steps, type Step } from '../components/Steps';
import { StickArt } from '../components/StickArt';
import { Trio } from '../components/Trio';
import { link, type Msg } from '../lib/link';
import { cpt, phoneReshare, pt, reshareCheck, type RootShare } from '../lib/root';
import { loadRoot, loadShard, rand, saveRoot, loadPendingJoin, savePendingJoin, clearPendingJoin, type PendingJoin } from '../lib/shard';
import { unlockShard } from '../lib/biometrics';
import { success, warn } from '../lib/haptics';
import { useStore } from '../store/store';
import { colors, fonts, radius, space } from '../theme';

type Phase = 'intro' | 'wake' | 'code' | 'split' | 'done' | 'error';
type Vault = { id: string; fingerprint: string; devPub: string; window: number };

const wait = <T extends Msg>(pred: (m: Msg) => boolean, ms: number, what: string) => link.waitFor<T>(pred, ms, what);

/**
 * Add a second stick. The wallet key is split again, three ways, and keeps the same public key,
 * so the account on-chain does not change. From then on every approval goes phone, wrist,
 * then the second stick over infrared.
 */
export default function SecondStick() {
  const { state } = useStore();
  const [phase, setPhase] = useState<Phase>('intro');
  const [three, setThree] = useState(false);
  const [pending, setPending] = useState<PendingJoin | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<'phone' | 'wrist' | 'stick' | null>(null);
  const [pieces, setPieces] = useState(0);
  const running = useRef(false);
  const phaseRef = useRef<Phase>('intro');
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    void loadRoot().then((r) => {
      const is3 = Boolean(r && r.parties === 3 && r.groupKey === state.address);
      setThree(is3);
      if (is3) setPhase('done');
      else void loadPendingJoin().then((join) => {
        if (join && join.root.groupKey === state.address) { setPending(join); setPhase('error'); setError('Setup paused. Your new share is safely saved. Reconnect the wrist and resume setup.'); }
      }).catch(() => { setError('Could not read saved setup. Try again.'); setPhase('error'); });
    });
  }, [state.address]);

  // The second stick answers only while its radio window is open (hold its button for 2 s).
  useEffect(() => {
    const off = link.on((m) => {
      if (m.t !== 'hello' || m.from !== 'vault') return;
      const v = { id: String(m.id), fingerprint: String(m.fingerprint), devPub: String(m.devPub), window: Number(m.window ?? 0) };
      setVault(v);
      // Found it with its window open: show the code to compare.
      if (phaseRef.current === 'wake' && v.window > 0) {
        void success();
        setPhase('code');
      }
    });
    const ask = () => link.send({ t: 'hello?', to: 'vault' });
    ask();
    const t = setInterval(ask, 2000);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const step = (label: string, detail: string, st: Step['state'] = 'active') =>
    setSteps((s) => {
      const i = s.findIndex((x) => x.label === label);
      const next = { label, detail, state: st };
      return i >= 0 ? s.map((x, k) => (k === i ? next : x)) : [...s, next];
    });

  const finishJoin = async (join: PendingJoin) => {
    const answer = wait((m) => m.t === 'root_committed' && m.id === join.id && !m.from, 30000, 'the wrist');
    link.send({ t: 'root_commit', id: join.id, groupKey: join.root.groupKey, X2: join.root.pub['2'] });
    const reply = await answer;
    if (reply.error || Number(reply.parties) !== 3 || reply.groupKey !== join.root.groupKey) throw new Error(String(reply.error ?? 'The wrist has not confirmed this setup. Reconnect and resume.'));
    await saveRoot(join.root);
    await clearPendingJoin();
    setPending(null); setFocus(null); setThree(true); setPhase('done'); void success();
  };
  const resume = async () => {
    if (!pending || running.current) return;
    running.current = true; setPhase('split'); setError(null);
    try {
      const u = await unlockShard('Resume second-stick setup');
      if (!u.ok) throw new Error(u.reason);
      await finishJoin(pending);
    } catch (e) { setError(e instanceof Error ? e.message : 'Reconnect the wrist and resume.'); setPhase('error'); }
    finally { running.current = false; }
  };

  const split = async () => {
    if (!vault || running.current || pending) return;
    running.current = true;
    setPhase('split');
    setSteps([]);
    setError(null);
    setPieces(0);
    const joinId = Array.from(rand(16), (b) => b.toString(16).padStart(2, '0')).join('');
    let stopProgress: (() => void) | undefined;
    try {
      setFocus('phone');
      const u = await unlockShard('Add the second stick');
      if (!u.ok) throw new Error(u.reason);
      const shard = await loadShard();
      if (!shard) throw new Error('This phone has no wallet key.');
      step('Phone', 'Unlocked', 'done');

      // 1. The wrist starts from the wallet key itself, so the account's key stays the same.
      const adopted = wait((m) => m.t === 'root_adopted' && !m.from, 15000, 'the wrist');
      if (!link.send({ t: 'root_adopt' })) throw new Error('The wrist is not connected.');
      const a = await adopted;
      if (a.joinProtocol !== 1) throw new Error('Update the wrist firmware before adding another stick.');
      if (a.error) throw new Error(a.error === 'already_3_of_3' ? 'This wallet already uses a second stick.' : `The wrist refused: ${String(a.error)}.`);
      if (String(a.groupKey) !== shard.groupKey) throw new Error('The wrist holds a different wallet. Nothing was changed.');
      const root: RootShare = { share: shard.share, groupKey: shard.groupKey, parties: 2, pub: { '1': cpt(pt(shard.X1)), '2': cpt(pt(shard.X2)) } };

      // 2. Phone and wrist each seal a random piece to the second stick; together they make its share.
      const ph = phoneReshare(root, vault.devPub, rand);
      const vaultDone = wait((m) => m.from === 'vault' && (m.t === 'reshare_vault' || m.t === 'reshare_error'), 120000, 'the second stick');
      stopProgress = link.on((m) => {
        if (m.from === 'vault' && m.t === 'reshare_progress') setPieces((n) => Math.max(n, 1));
      });
      const wristDone = wait((m) => (m.t === 'root_reshare' || (m.t === 'sign_reject' && m.id === 'root_reshare')) && !m.from, 120000, 'the wrist');
      link.send({ t: 'reshare_piece', to: 'vault', from: 'phone', ct: ph.sealed, groupKey: root.groupKey });
      setPieces(1);
      step('Second stick', 'Received the phone’s sealed piece');
      link.send({ t: 'root_reshare', id: joinId, vaultPub: vault.devPub });
      setFocus('wrist');
      step('Wrist', `Check it shows ${vault.fingerprint}, then hold the wrist’s button`);
      const w = await wristDone;
      if (w.t !== 'root_reshare') throw new Error(String(w.reason) === 'user' ? 'You said no on the wrist. Nothing was changed.' : `The wrist refused: ${String(w.reason)}.`);
      step('Wrist', 'Sent its sealed piece', 'done');
      setFocus('stick');
      setPieces(2);
      const v = await vaultDone;
      stopProgress();
      if (v.t !== 'reshare_vault') throw new Error(v.reason === 'window_closed' ? 'The second stick’s window closed. Hold its button again, then retry.' : 'The second stick could not open a piece.');
      step('Second stick', 'Joined', 'done');

      // 3. All three shares must still add up to the same key before anyone switches.
      if (!reshareCheck(root.groupKey, ph.X1, String(w.X2), String(v.X3))) throw new Error('The new shares do not add up to your wallet key. Nothing was changed.');
      const r3: RootShare = { share: ph.x1, groupKey: root.groupKey, parties: 3, pub: { '1': ph.X1, '2': String(w.X2), '3': String(v.X3) }, vaultPub: vault.devPub };
      // Durable before the first device replaces its live share. Retained until both confirm.
      const join: PendingJoin = { id: joinId, root: r3 };
      await savePendingJoin(join);
      setPending(join);
      await finishJoin(join);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Setup did not finish. Reconnect the devices and resume.');
      setFocus(null);
      setPhase('error');
      void warn();
    } finally {
      stopProgress?.();
      running.current = false;
    }
  };

  const wristLink = state.wrist.connected ? 'on' : 'searching';
  const stickLink = phase === 'wake' ? 'searching' : vault && vault.window > 0 ? 'on' : three ? 'off' : 'off';

  return (
    <Screen scroll>
      <TopBar title="Second stick" left={phase === 'split' ? undefined : { label: 'Close', onPress: () => router.back() }} />

      <Trio wrist={wristLink} stick={stickLink} beam="off" setup={phase === 'split' && pieces > 0 && !three} focus={focus} joined={three} />

      {phase === 'intro' ? (
        <View style={styles.gap}>
          <Txt size={26} weight="bold" lineHeight={32}>
            Add a second stick
          </Txt>
          <Txt size={15} color={colors.muted} lineHeight={22}>
            Your wallet key gets split three ways: phone, wrist and a second stick. Every approval then needs all three, and the sticks talk to each other only by infrared, so someone would need both in hand.
          </Txt>
          <Txt size={15} color={colors.muted} lineHeight={22}>
            Your account and its address stay the same. Revoking a key still needs only this phone.
          </Txt>
          <Button label="Start" variant="amber" onPress={() => setPhase('wake')} disabled={!state.wrist.connected} />
          {!state.wrist.connected ? (
            <Txt size={13} color={colors.red}>
              Connect your wrist stick first.
            </Txt>
          ) : null}
        </View>
      ) : null}

      {phase === 'wake' ? (
        <View style={styles.gap}>
          <Txt size={24} weight="bold">
            Wake the second stick
          </Txt>
          <Txt size={15} color={colors.muted} lineHeight={22}>
            Hold its button for 2 seconds. Its radio turns on for two minutes, just for this.
          </Txt>
          <View style={styles.art}>
            <StickArt pointToA screen="Hold" />
          </View>
          <Txt size={13} color={colors.faint} align="center">
            Looking for it over Bluetooth
          </Txt>
        </View>
      ) : null}

      {phase === 'code' && vault ? (
        <View style={styles.gap}>
          <Txt size={24} weight="bold">
            Same code on the second stick?
          </Txt>
          <View style={styles.code}>
            <Txt size={38} weight="bold" style={styles.codeText}>
              {vault.fingerprint}
            </Txt>
          </View>
          <Txt size={15} color={colors.muted} lineHeight={22}>
            This is the stick your key will be sealed to. If the codes differ, stop: another device is answering.
          </Txt>
          <Button label="It matches" variant="amber" onPress={() => void split()} />
        </View>
      ) : null}

      {phase === 'split' ? (
        <View style={styles.gap}>
          <Txt size={24} weight="bold">
            Splitting your key three ways
          </Txt>
          <Steps steps={steps} />
          <Txt size={13} color={colors.faint} lineHeight={19}>
            Neither the phone nor the wrist ever sees the second stick’s share. They each seal a random piece to it, and it adds them up.
          </Txt>
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={styles.gap}>
          <Txt size={22} weight="bold">
            Setup needs your attention
          </Txt>
          <Txt size={15} color={colors.red} lineHeight={22}>
            {error}
          </Txt>
          <Button label={pending ? "Resume saved setup" : "Try again"} onPress={() => pending ? void resume() : setPhase(vault && vault.window > 0 ? 'code' : 'wake')} />
        </View>
      ) : null}

      {phase === 'done' ? (
        <View style={styles.gap}>
          <Txt size={26} weight="bold" lineHeight={32}>
            Your wallet is 3 of 3
          </Txt>
          <Txt size={15} color={colors.muted} lineHeight={22}>
            New agent keys and higher limits now need your phone and both sticks. Agent transfers within their allowance stay automatic. For infrared approval, face the sticks toward each other at least 30 cm apart.
          </Txt>
          <Button label="Done" onPress={() => router.back()} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.m, marginTop: space.l },
  art: { alignItems: 'center', paddingVertical: space.m },
  code: { alignItems: 'center', paddingVertical: space.l, borderRadius: radius.m, backgroundColor: colors.panel },
  codeText: { fontFamily: fonts.monoBold, letterSpacing: 4 },
});
