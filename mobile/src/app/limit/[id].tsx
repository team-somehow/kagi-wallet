import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../components/Screen';
import { TopBar } from '../../components/TopBar';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { Fact } from '../../components/Fact';
import { ManagerSign } from '../../components/ManagerSign';
import { fmtEth, useChain } from '../../store/chain';
import * as evm from '../../lib/evm';
import { evmDeclineMessage, phoneOnlySign } from '../../lib/frost';
import { loadShard, rand } from '../../lib/shard';
import { unlockShard } from '../../lib/biometrics';
import { shortAddr } from '../../lib/format';
import { colors, radius, space } from '../../theme';

/**
 * An agent hit its allowance and asks for a higher total. This is more future access,
 * not a one-off payment. The decision is made on the stick; the hub confirms the new
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
      if (!i) throw new Error('Could not read Sepolia.');
      const sig = phoneOnlySign(shard, evmDeclineMessage(i.chainId, r.account, i.nonce, r.agent, r.newCap), rand);
      const d = await evm.declineLimit(r.account as `0x${string}`, r.agent as `0x${string}`, r.newCap, sig);
      setLimitLocal(r.id, { status: d.status === 'success' ? 'rejected' : 'failed', hash: d.hash, error: d.status === 'success' ? null : 'The decline reverted.' });
      void refresh();
    } catch (e) {
      setSent(false);
      setLimitLocal(r.id, { status: 'waiting', error: evm.reason(e) });
    }
  };

  const approve = async (sig: string) => {
    setSent(true);
    setLimitLocal(r.id, { status: 'submitting', error: null });
    try {
      const x = await evm.raiseLimit(r.account as `0x${string}`, { agent: r.agent as `0x${string}`, oldCap: r.oldCap, newCap: r.newCap, expiry: r.expiry, sig });
      setLimitLocal(r.id, { status: x.status === 'success' ? 'confirmed' : 'failed', hash: x.hash, error: x.status === 'success' ? null : 'The raise reverted on-chain.' });
      void refresh();
    } catch (e) {
      setLimitLocal(r.id, { status: 'failed', error: evm.reason(e) });
    }
  };

  const minutes = info ? Math.max(0, Math.round(Number(r.expiry - info.now) / 60)) : null;
  const extra = r.newCap - r.oldCap;
  const explorer = info?.explorer ?? 'https://sepolia.etherscan.io';

  return (
    <Screen scroll>
      <TopBar title="Limit request" left={{ label: 'Close', onPress: () => router.back() }} />
      <View style={styles.gap}>
        <Txt size={26} weight="bold" lineHeight={32}>
          {r.name} wants a higher limit
        </Txt>
        <Txt size={15} color={colors.muted} lineHeight={22}>
          {r.reason || 'Its next transfer does not fit in what is left.'}
        </Txt>

        <View style={styles.card}>
          <View style={styles.caps}>
            <View style={styles.capCol}>
              <Txt size={13} color={colors.muted}>
                Total now
              </Txt>
              <Txt mono size={17}>
                {fmtEth(r.oldCap)}
              </Txt>
            </View>
            <Txt size={20} color={colors.amber}>
              {'>'}
            </Txt>
            <View style={[styles.capCol, styles.right]}>
              <Txt size={13} color={colors.muted}>
                New total
              </Txt>
              <Txt mono size={17} color={colors.amber}>
                {fmtEth(r.newCap)}
              </Txt>
            </View>
          </View>
          <Fact label="Already spent" value={fmtEth(r.spent)} />
          <Fact label="Expiry" value={minutes === null ? 'unchanged' : `unchanged, ${minutes} min left`} mono={false} />
          <Fact label="Key" value={shortAddr(r.agent)} />
        </View>

        <View style={styles.note}>
          <Txt size={14} color={colors.amber} lineHeight={20}>
            This is extra future access. The agent can spend {fmtEth(extra)} more on its own, not just the one waiting transfer.
          </Txt>
        </View>

        {r.status === 'waiting' && !sent ? (
          nonce === null ? (
            <Txt size={14} color={colors.muted}>
              Reading the account from Sepolia
            </Txt>
          ) : (
            <>
              <ManagerSign
                autoStart
                action="Raise limit"
                phoneDetail="Unlock your share with your fingerprint"
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
                  // B on the stick is a decision. A timeout is not: the owner can try again.
                  if (reason === 'user') void decline();
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
        {r.status === 'submitting' ? <Status title="Sending your answer to Sepolia" body="The agent stays paused until it confirms on-chain." /> : null}
        {r.status === 'confirmed' ? (
          <>
            <Status title="New limit confirmed" body={`${r.name} can now spend up to ${fmtEth(r.newCap)} in total. It will retry its transfer.`} />
            {r.hash ? <Button label="View on Etherscan" variant="secondary" onPress={() => void Linking.openURL(`${explorer}/tx/${r.hash}`)} /> : null}
            <Button label="Done" onPress={() => router.back()} />
          </>
        ) : null}
        {r.status === 'rejected' ? (
          <>
            <Status title="Declined" body={`The limit stays at ${fmtEth(r.oldCap)}. The waiting transfer was not sent.`} />
            <Button label="Done" onPress={() => router.back()} />
          </>
        ) : null}
        {r.status === 'expired' ? <Status title="Request expired" body={`Nobody answered in time. The limit stays at ${fmtEth(r.oldCap)}.`} /> : null}
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
});
