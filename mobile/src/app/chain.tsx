import React, { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { TopBar } from '../components/TopBar';
import { Fact } from '../components/Fact';
import { ManagerSign } from '../components/ManagerSign';
import { useStore } from '../store/store';
import { link, type Msg } from '../lib/link';
import { shortAddr } from '../lib/format';
import { success, warn } from '../lib/haptics';
import { colors, space } from '../theme';

interface Info {
  chainId: number;
  relayer: string | null;
  relayerBalance: string;
  account: string | null;
  accountBalance: string;
  nonce: string;
  deployCost: string;
  callCost: string;
  explorer: string;
}

type Phase = 'idle' | 'deploying' | 'signing' | 'submitting' | 'done' | 'error';

// A test send: one microether to the burn address.
const TO = '0x000000000000000000000000000000000000dEaD';
const VALUE = 1_000_000_000_000n; // 0.000001 ETH
const FUND = 2_000_000_000_000n; // what the account starts with

const eth = (wei: string | bigint) => {
  const v = Number(BigInt(wei)) / 1e18;
  return `${v.toFixed(v > 0 && v < 0.0001 ? 8 : 6)} ETH`;
};

/** A real transaction on Sepolia through the Leash smart account, signed by phone and wrist. */
export default function Chain() {
  const { state } = useStore();
  const groupKey = state.address;
  const [info, setInfo] = useState<Info | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<{ hash: string; label: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!groupKey) return;
    try {
      const r = await link.request<Msg>({ t: 'evm_info?', groupKey }, 20000);
      if (r.t === 'evm_error') throw new Error(String(r.reason));
      setInfo(r as unknown as Info);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach Sepolia through the hub.');
    }
  }, [groupKey]);

  useEffect(() => {
    // Initial load. The reply lands in a callback, not in this effect.
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  const fail = (m: string) => {
    setError(m);
    setPhase('error');
    void warn();
  };

  const deploy = async () => {
    setPhase('deploying');
    setError(null);
    try {
      const r = await link.request<Msg>({ t: 'evm_deploy', groupKey, fund: FUND.toString() }, 200000);
      if (r.t === 'evm_error') return fail(String(r.reason));
      setTx({ hash: String(r.hash), label: 'Account deployed' });
      setPhase('idle');
      void success();
      await refresh();
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Deploy failed.');
    }
  };

  const submit = async (sig: string) => {
    setPhase('submitting');
    try {
      const r = await link.request<Msg>({ t: 'evm_submit', groupKey, to: TO, value: VALUE.toString(), data: '0x', sig }, 200000);
      if (r.t === 'evm_error') return fail(String(r.reason));
      setTx({ hash: String(r.hash), label: r.status === 'success' ? 'Landed on Sepolia' : 'Reverted on Sepolia' });
      setPhase('done');
      void success();
      await refresh();
    } catch (e) {
      fail(e instanceof Error ? e.message : 'Submitting failed.');
    }
  };

  const relayerLow = info ? BigInt(info.relayerBalance) < BigInt(info.account ? info.callCost : info.deployCost) + (info.account ? 0n : FUND) : false;

  return (
    <Screen scroll edges={['top', 'bottom']}>
      <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
      <Txt size={32} weight="bold" lineHeight={36}>
        Sepolia
      </Txt>
      <Txt size={17} color={colors.muted} style={styles.lead}>
        A smart account that only moves when phone and wrist both sign. The contract checks the signature itself.
      </Txt>

      <View style={styles.facts}>
        <Fact label="Account" value={info?.account ? shortAddr(info.account, 8, 6) : info ? 'not deployed' : 'loading'} />
        <Fact label="Balance" value={info?.account ? eth(info.accountBalance) : '–'} />
        <Fact label="Nonce" value={info?.account ? info.nonce : '–'} />
        <Fact label="Gas paid by" value={info?.relayer ? `${shortAddr(info.relayer, 6, 4)}, ${eth(info.relayerBalance)}` : '–'} color={relayerLow ? colors.red : colors.text} />
      </View>

      {relayerLow && info ? (
        <Txt size={14} color={colors.red} style={styles.note}>
          The gas payer needs about {eth(BigInt(info.account ? info.callCost : info.deployCost) + (info.account ? 0n : FUND))} for the next step.
        </Txt>
      ) : null}
      {error ? (
        <Txt size={14} color={colors.red} style={styles.note}>
          {error}
        </Txt>
      ) : null}

      {tx ? (
        <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(`${info?.explorer ?? 'https://sepolia.etherscan.io'}/tx/${tx.hash}`)} style={styles.tx}>
          <Txt size={15} weight="medium" color={colors.text}>
            {tx.label}
          </Txt>
          <Txt mono size={12} color={colors.muted}>
            {tx.hash}
          </Txt>
          <Txt size={13} color={colors.amber}>
            Open on Etherscan
          </Txt>
        </Pressable>
      ) : null}

      <View style={styles.actions}>
        {!info ? null : !info.account ? (
          <Button label="Deploy the account" onPress={() => void deploy()} loading={phase === 'deploying'} disabled={phase === 'deploying' || relayerLow} />
        ) : phase === 'submitting' ? (
          <Txt size={15} color={colors.amber}>
            Sending to Sepolia
          </Txt>
        ) : (
          <>
            <Txt size={15} color={colors.muted}>
              Send {eth(VALUE)} to {shortAddr(TO, 4, 4)} from the account.
            </Txt>
            <ManagerSign
              key={`${info.account}-${info.nonce}`}
              action="Sign and send"
              phoneDetail="Unlock to sign with the phone shard"
              payload={{
                kind: 'evm',
                agent: 'you',
                chainId: info.chainId,
                account: info.account,
                nonce: BigInt(info.nonce),
                to: TO,
                value: VALUE,
                data: '0x',
              }}
              onDone={(sig) => void submit(sig)}
            />
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { marginTop: space.m },
  facts: { marginTop: space.l },
  note: { marginTop: space.m },
  tx: { marginTop: space.l, gap: 4, padding: space.m, backgroundColor: colors.panel, borderRadius: 8 },
  actions: { marginTop: space.xl, gap: space.m },
});
