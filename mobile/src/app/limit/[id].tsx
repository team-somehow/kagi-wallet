import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Fact } from '../../components/Fact';
import { ManagerSign } from '../../components/ManagerSign';
import { InterceptaMark } from '../../components/BrandMarks';
import { fmtAmount, fmtEth, interceptaFlag, useChain } from '../../store/chain';
import * as evm from '../../lib/evm';
import { evmDeclineMessage, phoneOnlySign } from '../../lib/frost';
import { loadShard, rand } from '../../lib/shard';
import { unlockShard } from '../../lib/biometrics';
import { success } from '../../lib/haptics';
import { shortAddr } from '../../lib/format';
import { colors, radius, space } from '../../theme';

/**
 * An agent hit its allowance and asks for a higher total. This is more future access,
 * not a one-off payment. The decision is made on the stick; the phone confirms the new
 * cap on-chain before the agent retries.
 */
export default function LimitRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { limits, info, refresh, setLimitLocal } = useChain();
  const r = limits[String(id)];
  const [nonce, setNonce] = useState<bigint | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let live = true;
    void refresh().then((i) => live && i && setNonce(i.nonce));
    return () => {
      live = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (r?.status !== 'submitting' || !r.hash) return;
    let live = true;
    const hash = r.hash as `0x${string}`;
    const check = async () => {
      try {
        const receipt = await evm.pub.getTransactionReceipt({ hash });
        if (!live) return;
        if (receipt.status === 'reverted') {
          setSent(false);
          setLimitLocal(r.id, { status: 'waiting', hash: null, error: 'The transaction reverted. Review the current limit and try again.' });
        } else void refresh();
      } catch { /* Not mined or temporarily offline: keep tracking the public hash. */ }
    };
    void check();
    const timer = setInterval(() => void check(), 8000);
    return () => { live = false; clearInterval(timer); };
  }, [r?.status, r?.hash, r?.id, refresh, setLimitLocal]);

  if (!r) {
    return (
      <Screen>
        <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
        <Txt size={16} color={colors.muted}>
          This request is no longer open.
        </Txt>
      </Screen>
    );
  }

  // Declining needs only the phone's shard: saying no never waits on the stick.
  const decline = async () => {
    setSent(true);
    setLimitLocal(r.id, { status: 'submitting', error: null });
    try {
      const u = await unlockShard('Decline the higher limit');
      if (!u.ok) throw new Error(u.reason);
      const shard = await loadShard();
      if (!shard) throw new Error('This phone has no shard.');
      const i = (await refresh()) ?? info;
      if (!i) throw new Error('Could not read the chain.');
      const sig = phoneOnlySign(shard, evmDeclineMessage(i.chainId, r.account, i.nonce, r.agent, r.newCap), rand);
      const d = await evm.declineLimit(r.account as `0x${string}`, r.agent as `0x${string}`, r.newCap, sig, (hash) => setLimitLocal(r.id, { hash }));
      setLimitLocal(r.id, { status: d.status === 'success' ? 'rejected' : 'failed', hash: d.hash, error: d.status === 'success' ? null : 'The decline reverted.' });
      void refresh();
    } catch (e) {
      if (e instanceof evm.PendingTransactionError) {
        setLimitLocal(r.id, { status: 'submitting', hash: e.hash, error: e.message });
        return;
      }
      setSent(false);
      setLimitLocal(r.id, { status: 'waiting', error: evm.reason(e) });
    }
  };

  const approve = async (sig: string) => {
    setSent(true);
    setLimitLocal(r.id, { status: 'submitting', error: null });
    try {
      const x = await evm.raiseLimit(r.account as `0x${string}`, { agent: r.agent as `0x${string}`, oldCap: r.oldCap, newCap: r.newCap, expiry: r.expiry, sig }, (hash) => setLimitLocal(r.id, { hash }));
      if (x.status === 'success') void success();
      setLimitLocal(r.id, { status: x.status === 'success' ? 'confirmed' : 'failed', hash: x.hash, error: x.status === 'success' ? null : 'The raise reverted on-chain.' });
      void refresh();
    } catch (e) {
      if (e instanceof evm.PendingTransactionError) {
        setLimitLocal(r.id, { status: 'submitting', hash: e.hash, error: e.message });
        return;
      }
      setSent(false);
      setLimitLocal(r.id, { status: 'waiting', error: evm.reason(e) });
    }
  };

  const minutes = info ? Math.max(0, Math.round(Number(r.expiry - info.now) / 60)) : null;
  const extra = r.newCap - r.oldCap;
  // The agent server screens every recipient with Intercepta before its key signs. A flagged
  // one comes here as a request for exactly that payment, with the reasons in the text. Paying
  // it anyway is a bypass: it takes every device that holds the wallet key (phone and Kagi Wallet,
  // and the second stick over infrared once it has joined).
  const flag = interceptaFlag(r.reason);
  const held = flag !== null;
  const explorer = info?.explorer ?? 'https://sepolia.etherscan.io';

  return (
    <Screen scroll>
      <TopBar title="Limit request" left={{ label: 'Close', onPress: () => router.back() }} />
      <View style={styles.gap}>
        <Txt size={26} weight="bold" lineHeight={32}>
          {flag === 'blocked'
            ? `Intercepta blocked a payment by ${r.name}`
            : flag === 'held'
              ? `${r.name} wants to pay a flagged address`
              : `${r.name} wants a higher limit`}
        </Txt>
        {held ? (
          <View style={styles.flag}>
            <View style={styles.flagHead}>
              <InterceptaMark size={18} />
              <Txt size={13} weight="bold" color={colors.red} style={styles.flagTitle}>
                {flag === 'blocked' ? 'INTERCEPTA BLOCKED THIS PAYMENT' : 'INTERCEPTA HELD THIS PAYMENT'}
              </Txt>
            </View>
            <Txt size={15} lineHeight={22}>
              {r.reason.replace(/^Intercepta (held|blocked): /, '')}
            </Txt>
          </View>
        ) : (
          <Txt size={15} color={colors.muted} lineHeight={22}>
            {r.reason || 'Its next transfer does not fit in what is left.'}
          </Txt>
        )}

        <View style={styles.card}>
          <View style={styles.caps}>
            <View style={styles.capCol}>
              <Txt size={13} color={colors.muted}>
                Total now
              </Txt>
              <Txt size={27}>
                {fmtAmount(r.oldCap)}
              </Txt>
            </View>
            <Txt size={20} color={colors.amber}>
              {'→'}
            </Txt>
            <View style={[styles.capCol, styles.right]}>
              <Txt size={13} color={colors.muted}>
                New total
              </Txt>
              <Txt size={27} color={colors.amber}>
                {fmtAmount(r.newCap)}
              </Txt>
            </View>
          </View>
          <Fact label="Already spent" value={fmtEth(r.spent)} />
          <Fact label="Expiry" value={minutes === null ? 'unchanged' : `unchanged, ${minutes} min left`} mono={false} />
          <Fact label="Key" value={shortAddr(r.agent)} />
        </View>

        <View style={styles.note}>
          <Txt size={14} color={colors.amber} lineHeight={20}>
            {held
              ? `Bypass only if you trust this recipient: it overrides Intercepta and needs every device that holds your wallet key. It adds ${fmtEth(extra)}, exactly this payment, and the agent sends it. Decline and nothing is sent.`
              : `This is extra future access. The agent can spend ${fmtEth(extra)} more on its own, not just the one waiting transfer.`}
          </Txt>
        </View>

        {r.status === 'waiting' && !sent ? (
          nonce === null ? (
            <Txt size={14} color={colors.muted}>
              Reading the account on-chain
            </Txt>
          ) : (
            <>
              <ManagerSign
                action={held ? 'Bypass Intercepta' : 'Raise limit'}
                startLabel={held ? 'Bypass' : undefined}
                phoneDetail={held ? 'Unlock your share with your fingerprint, then sign on every device' : 'Unlock your share with your fingerprint'}
                payload={{
                  kind: 'evm_limit',
                  agent: r.name,
                  chainId: info?.chainId ?? 11155111,
                  account: r.account,
                  nonce,
                  agentAddress: r.agent,
                  oldCap: r.oldCap,
                  newCap: r.newCap,
                  expiry: r.expiry,
                }}
                onReject={(reason) => {
                  // A tap on the stick is a decision. A timeout is not: the owner can try again.
                  if (reason === 'user' || reason === 'vault_rejected') void decline();
                }}
                onDone={(sig) => void approve(sig)}
              />
              <Button label="Decline" variant="ghost" onPress={() => void decline()} />
            </>
          )
        ) : null}

        {r.error && r.status === 'waiting' ? (
          <Txt size={14} color={colors.red}>
            {r.error}
          </Txt>
        ) : null}
        {r.status === 'submitting' ? <>
          <Status title="Confirming on-chain" body="Your answer is submitted. The agent stays paused until the chain confirms it." />
          {r.hash ? <Button label="Track transaction" variant="secondary" onPress={() => void Linking.openURL(`${explorer}/tx/${r.hash}`)} /> : null}
          <Button label="Check confirmation" variant="ghost" onPress={() => void refresh()} />
        </> : null}
        {r.status === 'confirmed' ? (
          <>
            <Status title="New limit confirmed" body={`${r.name} can now spend up to ${fmtAmount(r.newCap)} in total. It will retry its transfer.`} />
            {r.hash ? <Button label="View on Etherscan" variant="secondary" onPress={() => void Linking.openURL(`${explorer}/tx/${r.hash}`)} /> : null}
            <Button label="Done" onPress={() => router.back()} />
          </>
        ) : null}
        {r.status === 'rejected' ? (
          <>
            <Status title="Declined" body={`The limit stays at ${fmtAmount(r.oldCap)}. The waiting transfer was not sent.`} />
            <Button label="Done" onPress={() => router.back()} />
          </>
        ) : null}
        {r.status === 'expired' ? <Status title="Request expired" body={`Nobody answered in time. The limit stays at ${fmtAmount(r.oldCap)}.`} /> : null}
        {r.status === 'failed' ? <Status title="The raise did not go through" body={r.error ?? 'It failed on-chain. The old limit stands.'} warn /> : null}
      </View>
    </Screen>
  );
}

function Status({ title, body, warn }: { title: string; body: string; warn?: boolean }) {
  return (
    <View style={styles.card}>
      <Txt size={18} weight="bold" color={warn ? colors.red : colors.text}>
        {title}
      </Txt>
      <Txt size={14} color={colors.muted} lineHeight={20}>
        {body}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { gap: space.m },
  card: { backgroundColor: colors.panel, borderRadius: radius.m, padding: space.m, gap: space.s },
  caps: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: space.s },
  capCol: { gap: 2 },
  right: { alignItems: 'flex-end' },
  note: { borderLeftWidth: 2, borderLeftColor: colors.amber, paddingLeft: space.m },
  flag: { borderWidth: 1, borderColor: colors.red, borderRadius: radius.m, padding: space.m, gap: space.xs },
  flagHead: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  flagTitle: { flex: 1 },
});
