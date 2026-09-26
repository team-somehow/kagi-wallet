import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { Fact } from '../components/Fact';
import { ManagerSign } from '../components/ManagerSign';
import { Steps } from '../components/Steps';
import { useStore } from '../store/store';
import { fmtEth, useChain } from '../store/chain';
import { chatUrl, link, type Msg } from '../lib/link';
import { newSessionKey, saveSessionKey, type SessionKey } from '../lib/session';
import { shortAddr } from '../lib/format';
import { success, warn } from '../lib/haptics';
import { colors, fonts, radius, space } from '../theme';

type Phase = 'form' | 'sign' | 'submitting' | 'done' | 'error';

const toWei = (eth: string): bigint | null => {
  const m = /^\s*(\d*)(?:\.(\d{0,18}))?\s*$/.exec(eth);
  if (!m || (!m[1] && !m[2])) return null;
  return BigInt(m[1] || '0') * 10n ** 18n + BigInt((m[2] ?? '').padEnd(18, '0') || '0');
};

/** Give an agent its own key: a total ETH allowance and an expiry, approved on the stick. */
export default function NewAgentKey() {
  const { state } = useStore();
  const { info, refresh, sessions } = useChain();
  const [name, setName] = useState(() => {
    const taken = new Set(sessions.map((x) => x.name));
    if (!taken.has('trader')) return 'trader';
    let n = 2;
    while (taken.has(`trader ${n}`)) n++;
    return `trader ${n}`;
  });
  const [allowance, setAllowance] = useState('0.000005');
  const [minutes, setMinutes] = useState('60');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<SessionKey | null>(null);
  const [plan, setPlan] = useState<{ cap: bigint; expiry: bigint; nonce: bigint; account: string; chainId: number } | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentHash, setSentHash] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // A clock for the waiting screen, only while it shows.
  useEffect(() => {
    if (phase !== 'submitting') return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  const cap = toWei(allowance);
  const mins = Number(minutes);
  const valid = name.trim().length > 0 && name.trim().length <= 16 && cap !== null && cap > 0n && mins >= 5 && mins <= 24 * 60;

  const start = async () => {
    setError(null);
    const i = (await refresh()) ?? info;
    if (!i?.account) {
      setError('This wallet has no Sepolia account yet. Create it from Home first.');
      return;
    }
    setKey(newSessionKey(name.trim()));
    setPlan({ cap: cap!, expiry: i.now + BigInt(Math.round(mins * 60)), nonce: i.nonce, account: i.account, chainId: i.chainId });
    setPhase('sign');
  };

  const submit = async (sig: string) => {
    if (!key || !plan) return;
    setPhase('submitting');
    setSentHash(null);
    setTick(0);
    const reqId = Math.random().toString(36).slice(2);
    const off = link.on((m) => {
      if (m.t === 'evm_sent' && m.progressFor === reqId) setSentHash(String(m.hash));
    });
    try {
      await saveSessionKey(key);
      const r = await link.request<Msg>(
        { t: 'evm_grant', reqId, groupKey: state.address, agent: key.address, name: key.name, cap: plan.cap.toString(), expiry: plan.expiry.toString(), sig },
        200000,
      );
      if (r.t === 'evm_error') throw new Error(String(r.reason));
      if (r.status !== 'success') throw new Error(`The grant reverted in ${String(r.hash)}.`);
      setHash(String(r.hash));
      setPhase('done');
      void success();
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The grant did not go through.');
      setPhase('error');
      void warn();
    } finally {
      off();
    }
  };

  const copy = async () => {
    if (!key) return;
    await Clipboard.setStringAsync(key.privateKey);
    setCopied(true);
    void success();
  };

  return (
    <Screen scroll>
      <TopBar title="Agent access" left={{ label: phase === 'done' ? 'Done' : 'Cancel', onPress: () => router.back() }} />

      {phase === 'form' ? (
        <View style={styles.gap}>
          <Txt size={26} weight="bold" lineHeight={32}>
            Give an agent its own key
          </Txt>
          <Txt size={15} color={colors.muted} lineHeight={22}>
            The agent spends up to this total without asking you. Anything more comes back to your stick.
          </Txt>
          <Field label="Agent name" value={name} onChange={setName} />
          <Field label="Total allowance, ETH" value={allowance} onChange={setAllowance} numeric mono />
          <Field label="Expires in, minutes" value={minutes} onChange={setMinutes} numeric mono />
          {error ? (
            <Txt size={14} color={colors.red}>
              {error}
            </Txt>
          ) : null}
          <Button label="Continue" onPress={() => void start()} disabled={!valid} />
        </View>
      ) : null}

      {phase === 'sign' && key && plan ? (
        <View style={styles.gap}>
          <Txt size={22} weight="bold">
            Approve on the stick
          </Txt>
          <View style={styles.card}>
            <Fact label="Agent" value={key.name} mono={false} />
            <Fact label="Key" value={shortAddr(key.address)} />
            <Fact label="Total allowance" value={fmtEth(plan.cap)} />
            <Fact label="Expires" value={`in ${minutes} min`} mono={false} />
          </View>
          <ManagerSign
            action="Approve agent key"
            phoneDetail="Unlock your share with your fingerprint"
            payload={{ kind: 'evm_grant', agent: key.name, chainId: plan.chainId, account: plan.account, nonce: plan.nonce, agentAddress: key.address, cap: plan.cap, expiry: plan.expiry }}
            onDone={(sig) => void submit(sig)}
          />
        </View>
      ) : null}

      {phase === 'submitting' && key && plan ? (
        <View style={styles.gap}>
          <Txt size={26} weight="bold" lineHeight={32}>
            Giving {key.name} access
          </Txt>
          <View style={styles.card}>
            <Fact label="Total allowance" value={fmtEth(plan.cap)} />
            <Fact label="Expires" value={`in ${minutes} min`} mono={false} />
            <Fact label="Key" value={shortAddr(key.address)} />
          </View>
          <Steps
            steps={[
              { label: 'Approved on your stick', detail: 'Phone and stick signed it together', state: 'done' },
              {
                label: sentHash ? 'Sent to Sepolia' : 'Sending to Sepolia',
                detail: sentHash ? `Transaction ${shortAddr(sentHash, 8, 6)}` : 'Handing the signed grant to the network',
                state: sentHash ? 'done' : 'active',
              },
              {
                label: 'Confirmed on-chain',
                detail: sentHash ? `Waiting for a block, ${tick} s so far. Usually about 15 s.` : 'Next',
                state: sentHash ? 'active' : 'todo',
              },
            ]}
          />
          <View style={styles.note}>
            <Txt size={14} color={colors.muted} lineHeight={20}>
              {key.name} cannot spend anything until this confirms. You can leave this screen. The key appears on Home once it is live.
            </Txt>
          </View>
          {sentHash ? (
            <Button label="Watch it on Etherscan" variant="ghost" onPress={() => void Linking.openURL(`${info?.explorer ?? 'https://sepolia.etherscan.io'}/tx/${sentHash}`)} />
          ) : null}
        </View>
      ) : null}

      {phase === 'error' ? (
        <View style={styles.gap}>
          <Txt size={22} weight="bold">
            The key was not granted
          </Txt>
          <Txt size={15} color={colors.red} lineHeight={22}>
            {error}
          </Txt>
          <Button label="Start over" variant="secondary" onPress={() => setPhase('form')} />
        </View>
      ) : null}

      {phase === 'done' && key && plan ? (
        <View style={styles.gap}>
          <Txt size={26} weight="bold" lineHeight={32}>
            {key.name} has access
          </Txt>
          <View style={styles.card}>
            <Fact label="Total allowance" value={fmtEth(plan.cap)} />
            <Fact label="Expires" value={`in ${minutes} min`} mono={false} />
            <Fact label="Grant" value={hash ? shortAddr(hash, 10, 6) : '-'} />
          </View>
          <Txt size={15} color={colors.muted} lineHeight={22}>
            Copy the session key and paste it into the agent chat. It can only spend its allowance. It is not your wallet key.
          </Txt>
          <Button label={copied ? 'Copied' : 'Copy session key'} variant="amber" onPress={() => void copy()} />
          <View style={styles.card}>
            <Txt size={13} color={colors.muted}>
              Agent chat
            </Txt>
            <Txt mono size={14} selectable>
              {chatUrl()}
            </Txt>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function Field({ label, value, onChange, numeric, mono }: { label: string; value: string; onChange: (s: string) => void; numeric?: boolean; mono?: boolean }) {
  return (
    <View style={styles.field}>
      <Txt size={13} color={colors.muted}>
        {label}
      </Txt>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.faint}
        style={[styles.input, { fontFamily: mono ? fonts.mono : fonts.sans }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.m },
  card: { backgroundColor: colors.panel, borderRadius: radius.m, padding: space.m, gap: space.s },
  field: { gap: space.xs },
  note: { borderLeftWidth: 2, borderLeftColor: colors.line, paddingLeft: space.m },
  input: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.m, color: colors.text, fontSize: 17, paddingHorizontal: space.m, paddingVertical: 12, backgroundColor: colors.panel },
});
