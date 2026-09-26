import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import * as evm from '../lib/evm';
import { formatEther } from 'viem';
import { fmtEth } from '../store/chain';
import { shortAddr } from '../lib/format';
import { Txt } from './Txt';
import { Button } from './Button';
import { colors, radius, space } from '../theme';

// Six decimals is plenty to read a balance at a glance; the confirmation shows the exact amount.
const short = (wei: bigint) => `${Number(formatEther(wei)).toLocaleString('en-US', { maximumFractionDigits: 6 })} ETH`;

type Quote = NonNullable<Awaited<ReturnType<typeof evm.sweepQuote>>>;

/**
 * Send everything in one wallet (the APK's gas sponsor, or the phone's own gas wallet) to the
 * owner's address, with a confirmation step. Uses whichever network the app is on.
 */
export function SweepCard({ source, title, note }: { source: evm.SweepSource; title: string; note?: string }) {
  const [q, setQ] = useState<Quote | null>(null);
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'sending'>('idle');
  const [result, setResult] = useState<{ hash: string; ok: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    evm
      .sweepQuote(source)
      .then(setQ)
      .catch((e: unknown) => setError(evm.reason(e)));
  }, [source]);

  useEffect(() => {
    load();
    return evm.onNetworkChange(() => {
      setResult(null);
      setPhase('idle');
      load();
    });
  }, [load]);

  const go = async () => {
    setPhase('sending');
    setError(null);
    try {
      const r = await evm.sweep(source);
      setResult({ hash: r.hash, ok: r.status === 'success' });
    } catch (e) {
      setError(e instanceof evm.PendingTransactionError ? e.message : evm.reason(e));
    } finally {
      setPhase('idle');
      load();
    }
  };

  if (!q) return null;
  const empty = q.value <= 0n;
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Txt weight="medium">{title}</Txt>
        <Txt mono size={14}>
          {short(q.balance)}
        </Txt>
      </View>
      <Txt mono size={12} color={colors.faint}>
        {shortAddr(q.address)} on {evm.networkLabel()}
      </Txt>
      {note ? (
        <Txt size={13} color={colors.muted} lineHeight={18}>
          {note}
        </Txt>
      ) : null}

      {phase === 'confirm' ? (
        <View style={styles.confirm}>
          <Txt size={14} lineHeight={20}>
            Send {fmtEth(q.value)} to {shortAddr(evm.OWNER_ADDRESS)}? The fee is at most {fmtEth(q.fee)}.
          </Txt>
          <Button label="Send it" variant="danger" onPress={() => void go()} />
          <Button label="Cancel" variant="ghost" onPress={() => setPhase('idle')} />
        </View>
      ) : (
        <Button
          label={phase === 'sending' ? 'Sending' : empty ? 'Nothing to sweep' : `Send it all to ${shortAddr(evm.OWNER_ADDRESS)}`}
          variant="secondary"
          loading={phase === 'sending'}
          disabled={empty || phase === 'sending'}
          onPress={() => setPhase('confirm')}
        />
      )}

      {result ? (
        <Button
          label={result.ok ? 'Swept. View on Etherscan' : 'It reverted. View on Etherscan'}
          variant="ghost"
          onPress={() => void Linking.openURL(`${evm.EXPLORER}/tx/${result.hash}`)}
        />
      ) : null}
      {error ? (
        <Txt size={13} color={colors.red}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.panel, borderRadius: radius.m, padding: space.m, gap: space.s },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  confirm: { gap: space.s, paddingTop: space.xs },
});
