import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { Fact } from '../components/Fact';
import { Pulse } from '../components/Pulse';
import { ManagerSign } from '../components/ManagerSign';
import { useStore } from '../store/store';
import { AGENTS, makeKey, makePubkey } from '../store/mock';
import { hours, shortAddr, usdc } from '../lib/format';
import { tap } from '../lib/haptics';
import { colors, fonts, radius, space } from '../theme';
import { goBack } from '../lib/nav';

const CAPS = [100, 250, 500, 1000];
const LIVES = [6, 12, 24];

type Phase = 'form' | 'agent' | 'sign' | 'issued';

function Choice<T extends string | number>({
  options,
  value,
  onChange,
  render,
}: {
  options: readonly T[];
  value: T | null;
  onChange: (v: T) => void;
  render: (v: T) => string;
}) {
  return (
    <View style={styles.choices}>
      {options.map((o) => {
        const on = o === value;
        return (
          <Pressable
            key={String(o)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => {
              void tap();
              onChange(o);
            }}
            style={[styles.choice, on && styles.choiceOn]}
          >
            <Txt size={15} weight="medium" color={on ? colors.onFill : colors.text}>
              {render(o)}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The human starts it: pick an agent, a cap and a lifetime. The agent still makes its own key. */
export default function Issue() {
  const { state, dispatch } = useStore();
  const [agentName, setAgentName] = useState('');
  const agent = agentName.trim() || null;
  // Names the wallet has already seen, so repeat agents are one tap.
  const known = useMemo(() => {
    const seen = new Set<string>(AGENTS);
    state.keys.forEach((k) => seen.add(k.agent));
    state.requests.forEach((r) => seen.add(r.agent));
    return [...seen];
  }, [state.keys, state.requests]);
  const [cap, setCap] = useState<number | null>(500);
  const [custom, setCustom] = useState('');
  const [life, setLife] = useState<number>(24);
  const [phase, setPhase] = useState<Phase>('form');
  const [pubkey, setPubkey] = useState<string | null>(null);

  const customCap = Number(custom.replace(/[^0-9.]/g, ''));
  const chosenCap = custom ? (customCap > 0 ? customCap : null) : cap;
  const tooHigh = chosenCap !== null && chosenCap > state.managerRaiseLimit;
  const ready = agent !== null && chosenCap !== null && !tooHigh;

  // The agent generates its keypair and sends back the public half.
  useEffect(() => {
    if (phase !== 'agent') return;
    const t = setTimeout(() => {
      setPubkey(makePubkey());
      setPhase('sign');
    }, 1600);
    return () => clearTimeout(t);
  }, [phase]);

  const issue = () => {
    if (!agent || chosenCap === null || !pubkey) return;
    dispatch({ type: 'ISSUE_KEY', key: makeKey(agent, chosenCap, life, pubkey) });
    setPhase('issued');
  };

  const footer =
    phase === 'form' ? (
      <Button label="Ask the agent for its key" onPress={() => setPhase('agent')} disabled={!ready} />
    ) : phase === 'issued' ? (
      <Button label="Done" onPress={() => goBack()} />
    ) : null;

  return (
    <Screen scroll edges={['top', 'bottom']} footer={footer}>
      <TopBar left={phase === 'issued' ? undefined : { label: 'Close', onPress: () => goBack() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        {phase === 'issued' ? 'Key issued' : 'Issue a key'}
      </Txt>
      <Txt size={17} color={colors.muted} style={styles.lead}>
        {phase === 'issued' && agent && chosenCap !== null
          ? `${agent} can spend up to ${usdc(chosenCap)} for the next ${hours(life)} without asking. Over that, the Kagi Wallet buzzes.`
          : 'Decide how much an agent may spend before you hear about it. The agent makes its own key. You only ever sign the limit.'}
      </Txt>

      {phase === 'form' ? (
        <View style={styles.form}>
          <View style={styles.field}>
            <Txt size={15} color={colors.muted}>
              Which agent
            </Txt>
            <TextInput
              value={agentName}
              onChangeText={setAgentName}
              placeholder="Name the agent"
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={32}
              style={styles.input}
            />
            <Choice options={known} value={agent} onChange={setAgentName} render={(a) => a} />
          </View>

          <View style={styles.field}>
            <Txt size={15} color={colors.muted}>
              Cap, in USDC over a rolling 24 hours
            </Txt>
            <Choice
              options={CAPS}
              value={custom ? null : cap}
              onChange={(c) => {
                setCustom('');
                setCap(c);
              }}
              render={usdc}
            />
            <TextInput
              value={custom}
              onChangeText={setCustom}
              placeholder="Or type an amount"
              placeholderTextColor={colors.faint}
              keyboardType="decimal-pad"
              inputMode="decimal"
              style={[styles.input, tooHigh && styles.inputBad]}
            />
            <Txt size={13} color={tooHigh ? colors.red : colors.faint}>
              {tooHigh
                ? `Above ${usdc(state.managerRaiseLimit)} needs the vault, not just phone and Kagi Wallet.`
                : `Phone and Kagi Wallet can grant up to ${usdc(state.managerRaiseLimit)}. Beyond that is a vault trip.`}
            </Txt>
          </View>

          <View style={styles.field}>
            <Txt size={15} color={colors.muted}>
              Lives for
            </Txt>
            <Choice options={LIVES} value={life} onChange={setLife} render={hours} />
          </View>
        </View>
      ) : (
        <View style={styles.facts}>
          <Fact label="Agent" value={agent ?? ''} mono={false} />
          <Fact label="Cap" value={`${usdc(chosenCap ?? 0)} USDC`} color={colors.amber} />
          <Fact label="Lives for" value={hours(life)} mono={false} />
          <Fact label="Agent key" value={pubkey ? shortAddr(pubkey, 10, 6) : 'waiting'} color={pubkey ? colors.text : colors.muted} />
        </View>
      )}

      {phase === 'agent' ? (
        <View style={styles.waiting}>
          <Pulse color={colors.text} />
          <Txt size={16}>Asking {agent} to generate a keypair</Txt>
        </View>
      ) : null}

      {phase === 'sign' ? (
        <View style={styles.sign}>
          <Txt size={15} color={colors.muted} style={styles.signLead}>
            The agent sent its public key. Its private half never left the agent. Signing binds this cap and lifetime to it.
          </Txt>
          {agent && pubkey && chosenCap !== null ? (
            <ManagerSign
              action="Sign the grant"
              phoneDetail="Unlock to sign the grant with the phone shard"
              payload={{ kind: 'grant', agent, pubkey, capUsdc: chosenCap, hours: life }}
              onDone={issue}
            />
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.m },
  form: { marginTop: space.l, gap: space.l },
  field: { gap: space.s },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  choice: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.line,
  },
  choiceOn: { backgroundColor: colors.text, borderColor: colors.text },
  input: {
    fontFamily: fonts.mono,
    fontSize: 16,
    color: colors.text,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.m,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.panel,
  },
  inputBad: { borderColor: colors.red },
  facts: { marginTop: space.l },
  waiting: { marginTop: space.xl, flexDirection: 'row', alignItems: 'center', gap: space.m },
  sign: { marginTop: space.l, gap: space.m },
  signLead: {},
});
