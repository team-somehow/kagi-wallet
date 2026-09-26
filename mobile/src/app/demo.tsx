import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Switch, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { TopBar } from '../components/TopBar';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { useChain } from '../store/chain';
import { DEMO_RECIPIENT, restoreAgentDemo, runAgentDemo, useAgentDemo } from '../lib/agentDemo';
import { EXPLORER } from '../lib/evm';
import { usePresentation } from '../components/Presentation';
import { resetEverything, type ResetStep } from '../lib/reset';
import { useStore } from '../store/store';
import { colors, radius, space } from '../theme';

/** Presentation settings operate the real app, plus a reset that the wrist has to confirm. */
export default function PresentationSettings() {
  const p = usePresentation();
  const demo = useAgentDemo();
  const { info, live } = useChain();
  const key = live.find((s) => s.cap === 5_000_000_000_000n || s.cap === 20_000_000_000_000n) ?? live[0];
  const { sim } = useStore();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  useEffect(() => {
    void restoreAgentDemo().catch(() => {}); // Reopening retries if the chain is temporarily unavailable.
  }, []);

  const startReset = async () => {
    setResetError(null);
    try {
      await resetEverything(setResetStep);
      sim.reset();
      router.dismissAll();
      router.replace('/onboarding');
    } catch (e) {
      setResetStep(null);
      setResetError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Screen scroll>
      <TopBar title="Presentation" left={{ label: 'Close', onPress: () => router.back() }} />
      <View style={styles.body}>
        <Txt size={32}>Make it physical.</Txt>
        <Txt size={15} color={colors.muted}>
          One wallet. Start with your phone and wrist, then add a second stick for infrared approvals.
        </Txt>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Txt>Keep screen awake</Txt>
            <Txt size={13} color={colors.muted}>
              While Kagi is open. Your normal timeout resumes when you leave.
            </Txt>
          </View>
          <Switch accessibilityLabel="Keep Kagi awake" value={p.awake} onValueChange={(awake) => p.update({ awake })} />
        </View>
        <View style={styles.row}>
          <View style={styles.copy}>
            <Txt>Wrist sounds</Txt>
            <Txt size={13} color={colors.muted}>
              Soft approval cues. Infrared reception stays quiet.
            </Txt>
          </View>
          <Switch accessibilityLabel="Wrist sounds" value={p.sound} onValueChange={(sound) => p.update({ sound })} />
        </View>
        <View style={styles.testAgent}>
          <Txt size={22}>In-app test agent</Txt>
          <Txt size={14} color={colors.muted}>
            Real on-chain transfers from the selected session key. Act one sends 2 + 8 µETH; act two sends 12 µETH after
            adding the second device.
          </Txt>
          <Txt size={12} mono color={colors.muted}>
            Pays {DEMO_RECIPIENT}
          </Txt>
          <Txt size={14} color={colors.amber}>
            {demo.message}
          </Txt>
          {key && info?.account ? (
            <>
              <Txt size={13}>Session: {key.name}</Txt>
              <Button
                label={demo.running ? 'Agent running' : demo.saved ? 'Resume saved run' : 'Run act one · 2 + 8 µETH'}
                loading={demo.running}
                disabled={!demo.saved && key.cap !== 5_000_000_000_000n}
                onPress={() => void runAgentDemo(info.account as `0x${string}`, key.address as `0x${string}`)}
              />
              {!demo.saved && !demo.running && key.cap === 20_000_000_000_000n ? (
                <Button
                  label="Run act two · 12 µETH"
                  variant="secondary"
                  onPress={() => void runAgentDemo(info.account as `0x${string}`, key.address as `0x${string}`, true)}
                />
              ) : null}
            </>
          ) : (
            <Txt size={14} color={colors.muted}>
              Create a 5 µETH session key below to start.
            </Txt>
          )}
          {demo.hash ? (
            <Button
              label="View transaction"
              variant="ghost"
              onPress={() => void Linking.openURL(`${EXPLORER}/tx/${demo.hash}`)}
            />
          ) : null}
        </View>
        <Button label="Agent access" onPress={() => router.push('/agent')} />
        <Button label="Second stick" variant="secondary" onPress={() => router.push('/vault')} />
        <Txt size={12} color={colors.muted}>
          Real on-chain test ETH. Keys and approvals are enforced by your wallet contract.
        </Txt>

        <View style={styles.reset}>
          <Txt size={22}>Reset everything</Txt>
          <Txt size={14} color={colors.muted}>
            Erases the wallet key share on the wrist and on this phone, and forgets every agent key, so you can set up a new
            wallet from the start. The wrist has to confirm first; until it does, nothing is erased.
          </Txt>
          {!resetOpen ? (
            <Button label="Reset everything" variant="danger" onPress={() => setResetOpen(true)} />
          ) : resetStep === 'confirm_on_wrist' ? (
            <Txt size={15} color={colors.amber}>
              Hold the wrist’s button to erase its share. Tap it to keep everything.
            </Txt>
          ) : resetStep ? (
            <Txt size={15} color={colors.muted}>
              Erasing this phone’s share…
            </Txt>
          ) : (
            <>
              <Txt size={14} color={colors.red}>
                The current wallet can’t be used again after this. Any ETH still in it stays there.
              </Txt>
              <Button label="Erase wrist and phone" variant="danger" onPress={() => void startReset()} />
              <Button label="Cancel" variant="ghost" onPress={() => { setResetOpen(false); setResetError(null); }} />
            </>
          )}
          {resetError ? (
            <Txt size={14} color={colors.red}>
              {resetError}
            </Txt>
          ) : null}
        </View>
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  testAgent: { backgroundColor: colors.panel, borderRadius: radius.m, padding: space.m, gap: space.m },
  body: { gap: space.l, marginTop: space.l },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.m,
    padding: space.m,
    backgroundColor: colors.panel,
    borderRadius: radius.m,
  },
  copy: { flex: 1, gap: 5 },
  reset: { borderWidth: 1, borderColor: colors.red, borderRadius: radius.m, padding: space.m, gap: space.m, marginTop: space.l },
});
