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
import { fmtEth, useChain } from '../store/chain';
import * as evm from '../lib/evm';
import { connectionString, newSessionKey, saveSessionKey, type SessionKey } from '../lib/session';
import { shortAddr } from '../lib/format';
import { success, warn } from '../lib/haptics';
import { colors, fonts, radius, space } from '../theme';

type Phase = 'form' | 'sign' | 'submitting' | 'done' | 'error';

// The agent pays its own gas, so its key gets a little Sepolia ETH with the grant: enough for
// a handful of transfers and limit requests at about 1 gwei.
const AGENT_GAS = 500_000_000_000_000n; // 0.0005 ETH
// What the grant itself costs, with room to spare.
const GRANT_GAS = 300_000_000_000_000n; // 0.0003 ETH

const toWei = (eth: string): bigint | null => {
  const m = /^\s*(\d*)(?:\.(\d{0,18}))?\s*$/.exec(eth);
  if (!m || (!m[1] && !m[2])) return null;
  return BigInt(m[1] || '0') * 10n ** 18n + BigInt((m[2] ?? '').padEnd(18, '0') || '0');
};

/** Give an agent its own key: a total ETH allowance and an expiry, approved on the stick. */
export default function NewAgentKey() {
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
  const [gasStep, setGasStep] = useState<'todo' | 'active' | 'done' | 'failed'>('todo');
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
    if (i.gasBalance < AGENT_GAS + GRANT_GAS) {
      setError(`The phone's gas wallet needs at least ${fmtEth(AGENT_GAS + GRANT_GAS)}. It has ${fmtEth(i.gasBalance)}. Top it up from Home.`);
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
    setGasStep('todo');
    setTick(0);
    try {
      await saveSessionKey(key);
      const r = await evm.grant(plan.account as `0x${string}`, { agent: key.address as `0x${string}`, cap: plan.cap, expiry: plan.expiry, sig }, (h) => setSentHash(h));
      if (r.status !== 'success') throw new Error(`The grant reverted in ${r.hash}.`);
      setHash(r.hash);
      // Gas money for the agent's own key. The grant stands even if this fails.
      setGasStep('active');
      try {
        const g = await evm.sendGas(key.address as `0x${string}`, AGENT_GAS);
        setGasStep(g.status === 'success' ? 'done' : 'failed');
      } catch {
        setGasStep('failed');
      }
      setPhase('done');
      void success();
      void refresh();
    } catch (e) {
      setError(evm.reason(e));
      setPhase('error');
      void warn();
    }
  };

  const copy = async () => {
    if (!key) return;
    if (!plan) return;
    await Clipboard.setStringAsync(connectionString(key, plan.account));
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
                detail: hash ? 'The key is live' : sentHash ? `Waiting for a block, ${tick} s so far. Usually about 15 s.` : 'Next',
                state: hash ? 'done' : sentHash ? 'active' : 'todo',
              },
              {
                label: 'Gas for the agent',
                detail: gasStep === 'active' ? `Sending ${fmtEth(AGENT_GAS)} so the agent can pay its own fees` : 'Next',
                state: gasStep === 'active' ? 'active' : 'todo',
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
          {gasStep === 'failed' ? (
            <Txt size={14} color={colors.amber} lineHeight={20}>
              The gas top-up for the agent did not go through. Send it a little Sepolia ETH at {shortAddr(key.address)} before it spends.
            </Txt>
          ) : null}
          <Txt size={15} color={colors.muted} lineHeight={22}>
            Copy the session key and paste it into your agent, for example the Leash MCP server. It can only spend its allowance. It is not your wallet key.
          </Txt>
          <Button label={copied ? 'Copied' : 'Copy session key'} variant="amber" onPress={() => void copy()} />
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
