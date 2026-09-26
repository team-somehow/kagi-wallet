import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { Fact } from '../components/Fact';
import { Steps, type Step } from '../components/Steps';
import { link, type Msg } from '../lib/link';
import * as evm from '../lib/evm';
import { dkgFinish, dkgStart, evmMessage } from '../lib/frost';
import { combineRoot, cpt, partial, phoneReshare, pt, reshareCheck, rootNonces, type Commit, type RootShare } from '../lib/root';
import { loadRoot, rand, saveRoot } from '../lib/shard';
import { unlockShard } from '../lib/biometrics';
import { success, warn } from '../lib/haptics';
import { colors, space } from '../theme';

interface VaultInfo {
  id: string;
  fingerprint: string;
  devPub: string;
  joined: boolean;
  window: number;
}

type Busy = null | 'dkg' | 'reshare' | 'sign';

// The root action this screen signs: send a little ETH out of the root treasury, a Sepolia
// contract only the 3-of-3 root key (phone + wrist + vault) can move.
const TO = '0x000000000000000000000000000000000000dEaD';
const VALUE = 1_000_000_000_000n; // 0.000001 ETH
const FUND = 10_000_000_000_000n; // the treasury starts with 0.00001 ETH

const wait = <T extends Msg>(pred: (m: Msg) => boolean, ms: number, what: string) => link.waitFor<T>(pred, ms, what);

/** The 3-of-3 root key: phone, wrist, and the vault that only speaks IR. */
export default function Vault() {
  const [root, setRoot] = useState<RootShare | null>(null);
  const [vault, setVault] = useState<VaultInfo | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sig, setSig] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState(false);
  const [txs, setTxs] = useState<{ label: string; hash: string }[]>([]);
  const [treasury, setTreasury] = useState<{ account: string | null; balance: string; relayerBalance: string } | null>(null);

  const loadTreasury = useCallback(async (r: RootShare | null) => {
    if (!r || r.parties !== 3) return;
    try {
      const i = await evm.rootInfo(r.groupKey);
      setTreasury({ account: i.account, balance: String(i.balance), relayerBalance: String(i.gasBalance) });
    } catch {
      // offline: the screen still works without chain info
    }
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void loadTreasury(root), 0);
    return () => clearTimeout(t);
  }, [root, loadTreasury]);

  useEffect(() => {
    void loadRoot().then(setRoot);
    const off = link.on((m) => {
      if (m.t === 'hello' && m.from === 'vault')
        setVault({ id: String(m.id), fingerprint: String(m.fingerprint), devPub: String(m.devPub), joined: Boolean(m.joined), window: Number(m.window ?? 0) });
    });
    const ask = () => link.send({ t: 'hello?', to: 'vault' });
    ask();
    const t = setInterval(ask, 2500);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  const step = (label: string, detail: string, state: Step['state'] = 'active') =>
    setSteps((s) => {
      const i = s.findIndex((x) => x.label === label);
      const next = { label, detail, state };
      return i >= 0 ? s.map((x, k) => (k === i ? next : x)) : [...s, next];
    });

  const run = useCallback(async (kind: Exclude<Busy, null>, fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    setSteps([]);
    try {
      await fn();
      void success();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
      void warn();
    } finally {
      setBusy(null);
    }
  }, []);

  const createRoot = () =>
    run('dkg', async () => {
      const u = await unlockShard('Create the root key');
      if (!u.ok) throw new Error(u.reason);
      const mine = dkgStart(rand);
      step('Wrist', 'Press A on the wrist to create the root key');
      const reply = wait((m) => (m.t === 'root_dkg' || (m.t === 'sign_reject' && m.id === 'root_dkg')) && !m.from, 90000, 'the wrist');
      link.send({ t: 'root_dkg', X: mine.X, pop: mine.pop });
      const d = await reply;
      if (d.t !== 'root_dkg') throw new Error(`The wrist refused: ${String(d.reason)}.`);
      const s = dkgFinish(mine, String(d.X), d.pop as never);
      const r: RootShare = { share: s.share, groupKey: s.groupKey, parties: 2, pub: { '1': cpt(pt(s.X1)), '2': cpt(pt(s.X2)) } };
      await saveRoot(r);
      setRoot(r);
      step('Wrist', 'Root key created, 2 of 2', 'done');
    });

  const addVault = () =>
    run('reshare', async () => {
      if (!root || !vault) return;
      setConfirmCode(false);
      const u = await unlockShard('Add the vault');
      if (!u.ok) throw new Error(u.reason);
      const ph = phoneReshare(root, vault.devPub, rand);
      step('Vault', `Sealed to the vault's key ${vault.fingerprint}`);
      const vaultDone = wait((m) => m.from === 'vault' && (m.t === 'reshare_vault' || m.t === 'reshare_error'), 120000, 'the vault');
      const wristDone = wait((m) => (m.t === 'root_reshare' || (m.t === 'sign_reject' && m.id === 'root_reshare')) && !m.from, 120000, 'the wrist');
      link.send({ t: 'reshare_piece', to: 'vault', from: 'phone', ct: ph.sealed, groupKey: root.groupKey });
      link.send({ t: 'root_reshare', vaultPub: vault.devPub });
      step('Wrist', `Check the wrist shows ${vault.fingerprint}, then press A`);
      const w = await wristDone;
      if (w.t !== 'root_reshare') throw new Error(`The wrist refused: ${String(w.reason)}.`);
      step('Wrist', 'Sent its piece to the vault', 'done');
      const v = await vaultDone;
      if (v.t !== 'reshare_vault') throw new Error(v.reason === 'window_closed' ? 'The vault window closed. Hold A on the vault again.' : 'The vault could not open a piece.');
      step('Vault', 'Joined', 'done');
      if (!reshareCheck(root.groupKey, ph.X1, String(w.X2), String(v.X3))) throw new Error('The shares do not add up to the root key. Nothing was changed.');
      const committed = wait((m) => m.t === 'root_committed', 30000, 'the wrist');
      link.send({ t: 'root_commit' });
      if (Number((await committed).parties) !== 3) throw new Error('The wrist did not switch to 3 of 3.');
      const r3: RootShare = { share: ph.x1, groupKey: root.groupKey, parties: 3, pub: { '1': ph.X1, '2': String(w.X2), '3': String(v.X3) }, vaultPub: vault.devPub };
      await saveRoot(r3);
      setRoot(r3);
      step('Root key', 'Now 3 of 3. Same key as before.', 'done');
    });

  const signRoot = () =>
    run('sign', async () => {
      if (!root || root.parties !== 3) return;
      setSig(null);
      const u = await unlockShard('Send from the root treasury');
      if (!u.ok) throw new Error(u.reason);
      // 1. The treasury, created once per root key, paid for by the phone's gas wallet.
      let info = await evm.rootInfo(root.groupKey);
      if (!info.account) {
        step('Sepolia', 'Creating the root treasury (about 20 s)');
        const d = await evm.rootDeploy(root.groupKey, FUND);
        setTxs((t) => [...t, { label: 'Root treasury created', hash: String(d.hash) }]);
        info = await evm.rootInfo(root.groupKey);
        step('Sepolia', `Treasury ${String(info.account).slice(0, 10)}…`, 'done');
      }
      // 2. Sign the send, 3 of 3.
      const m = evmMessage({ chainId: Number(info.chainId), account: String(info.account), nonce: BigInt(String(info.nonce)), to: TO, value: VALUE, data: '0x' });
      const n1 = rootNonces(rand);
      const id = `root${Date.now()}`;
      step('Phone', 'Signed its part', 'done');
      step('Wrist', 'Press A on the wrist');
      const off = link.on((x) => {
        if (x.t !== 'root_progress' || x.id !== id) return;
        if (x.step === 'ir_to_vault') {
          step('Wrist', 'Pressed', 'done');
          step('Vault', 'Sending to the vault by IR. Keep the wrist pointed at it.');
        }
        if (x.step === 'vault_prompted') step('Vault', 'Press A on the vault');
      });
      const ans = wait((x) => (x.t === 'root_share' || x.t === 'sign_reject') && x.id === id, 240000, 'the wrist and vault');
      link.send({ t: 'root_sign', kind: 'evm', id, chainId: String(info.chainId), account: String(info.account), nonce: String(info.nonce), to: TO, value: VALUE.toString(), D: n1.D, E: n1.E });
      let signature: string;
      try {
        const r = await ans;
        if (r.t === 'sign_reject') {
          const why: Record<string, string> = {
            vault_rejected: 'You pressed B on the vault.',
            vault_timeout: 'The vault did not answer. Point the wrist at it and try again.',
            ir_failed: 'The vault was not in sight of the wrist.',
            user: 'You pressed B on the wrist.',
          };
          throw new Error(why[String(r.reason)] ?? `Refused: ${String(r.reason)}.`);
        }
        step('Vault', 'Signed over IR', 'done');
        const cs: Commit[] = [
          { id: 1, D: n1.D, E: n1.E },
          { id: 2, D: String(r.D2), E: String(r.E2) },
          { id: 3, D: String(r.D3), E: String(r.E3) },
        ];
        const z1 = partial(root.share, root.groupKey, m, cs, 1, n1);
        signature = combineRoot(root, m, cs, { 1: z1, 2: String(r.z2), 3: String(r.z3) });
        setSig(signature);
      } finally {
        off();
      }
      // 3. Send it.
      step('Sepolia', 'Sending the transaction');
      const sub = await evm.rootSubmit(root.groupKey, { to: TO as `0x${string}`, value: VALUE, sig: signature });
      setTxs((t) => [...t, { label: `Sent 0.000001 ETH, ${String(sub.status)}`, hash: String(sub.hash) }]);
      step('Sepolia', 'Landed', 'done');
      await loadTreasury(root);
    });

  const windowOpen = (vault?.window ?? 0) > 0;

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        Vault
      </Txt>
      <Txt size={16} color={colors.muted} style={styles.lead}>
        Root actions, like raising a cap past what phone and wrist may grant, need a third shard that lives at home and only answers by infrared.
      </Txt>

      <View style={styles.facts}>
        <Fact label="Root key" value={!root ? 'none yet' : root.parties === 3 ? '3 of 3' : '2 of 2, no vault'} mono={false} color={root?.parties === 3 ? colors.text : colors.muted} />
        <Fact label="Vault" value={!vault ? 'not found' : `${vault.id}, code ${vault.fingerprint}`} mono={false} />
        {treasury ? <Fact label="Root treasury" value={treasury.account ? `${treasury.account.slice(0, 10)}…, ${(Number(treasury.balance) / 1e18).toFixed(6)} ETH` : 'not created yet'} mono={false} /> : null}
        {treasury ? <Fact label="Gas payer" value={`${(Number(treasury.relayerBalance) / 1e18).toFixed(6)} ETH`} mono={false} color={Number(treasury.relayerBalance) < 3.5e14 ? colors.red : colors.text} /> : null}
        {vault ? <Fact label="Vault radio" value={windowOpen ? `window open, ${vault.window} s` : 'off'} mono={false} color={windowOpen ? colors.amber : colors.text} /> : null}
      </View>

      {steps.length ? (
        <View style={styles.section}>
          <Steps steps={steps} />
        </View>
      ) : null}
      {error ? (
        <Txt size={14} color={colors.red} style={styles.note}>
          {error}
        </Txt>
      ) : null}
      {txs.map((t) => (
        <Pressable key={t.hash} accessibilityRole="link" onPress={() => void Linking.openURL(`https://sepolia.etherscan.io/tx/${t.hash}`)} style={styles.sig}>
          <Txt size={15} weight="medium">
            {t.label}
          </Txt>
          <Txt mono size={11} color={colors.amber}>
            {t.hash}
          </Txt>
        </Pressable>
      ))}
      {sig ? (
        <View style={styles.sig}>
          <Txt size={15} weight="medium">
            Root signature, 3 of 3, verified
          </Txt>
          <Txt mono size={11} color={colors.muted}>
            {sig}
          </Txt>
        </View>
      ) : null}

      <View style={styles.section}>
        {!root ? (
          <Button label="Create the root key" onPress={() => void createRoot()} loading={busy === 'dkg'} disabled={busy !== null} />
        ) : root.parties === 2 ? (
          !vault ? (
            <Txt size={15} color={colors.muted}>
              Plug in the vault or bring it online.
            </Txt>
          ) : !windowOpen ? (
            <Txt size={15} color={colors.amber}>
              Hold A on the vault for 2 seconds to open its window.
            </Txt>
          ) : !confirmCode ? (
            <>
              <Txt size={15} color={colors.text}>
                The vault is showing a code. Does it read {vault.fingerprint}?
              </Txt>
              <Button label="It matches, add the vault" onPress={() => setConfirmCode(true)} disabled={busy !== null} />
            </>
          ) : (
            <Button label="Reshare to 3 of 3" variant="amber" onPress={() => void addVault()} loading={busy === 'reshare'} disabled={busy !== null} />
          )
        ) : (
          <>
            <Txt size={15} color={colors.muted}>
              Send 0.000001 ETH out of the root treasury on Sepolia. Needs phone, wrist and vault.
            </Txt>
            <Button label="Send from the root treasury" variant="amber" onPress={() => void signRoot()} loading={busy === 'sign'} disabled={busy !== null} />
          </>
        )}
        {root && busy === null ? (
          <Button label="Start over with a new root key" variant="ghost" onPress={() => void createRoot()} />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.m },
  facts: { marginTop: space.l },
  section: { marginTop: space.xl, gap: space.m },
  note: { marginTop: space.m },
  sig: { marginTop: space.l, gap: 4 },
});
