import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../components/Screen';
import { Txt } from '../../components/Txt';
import { Button } from '../../components/Button';
import { TopBar } from '../../components/TopBar';
import { Fact } from '../../components/Fact';
import { ManagerSign } from '../../components/ManagerSign';
import { useStore } from '../../store/store';
import { shortAddr, usdc } from '../../lib/format';
import { success, tap } from '../../lib/haptics';
import { colors, radius, space } from '../../theme';

export default function Sign() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch } = useStore();
  const req = state.signs.find((s) => s.id === id);
  const key = req ? state.keys.find((k) => k.id === req.keyId) : undefined;
  const [showRaw, setShowRaw] = useState(false);
  const reqId = req?.id;
  const status = req?.status;

  // After both shards sign, the tx goes out. A moment later it lands.
  useEffect(() => {
    if (status !== 'signed' || !reqId) return;
    const t = setTimeout(() => {
      dispatch({ type: 'SIGN_UPDATE', id: reqId, status: 'landed' });
      void success();
    }, 1400);
    return () => clearTimeout(t);
  }, [status, reqId, dispatch]);

  if (!req || !key || !status) {
    return (
      <Screen>
        <TopBar left={{ label: 'Close', onPress: () => router.back() }} />
        <Txt size={17} color={colors.muted}>
          This request is gone.
        </Txt>
      </Screen>
    );
  }

  const headroom = Math.max(key.capUsdc - key.spentUsdc, 0);
  const settled = status === 'landed' || status === 'rejected';

  const reject = () => {
    dispatch({ type: 'SIGN_UPDATE', id: req.id, status: 'rejected' });
    router.back();
  };

  const title =
    status === 'landed' ? 'Landed' : status === 'signed' ? 'Sending' : status === 'rejected' ? 'Rejected' : 'Over the cap';

  return (
    <Screen
      scroll
      edges={['top', 'bottom']}
      footer={
        settled ? (
          <Button label="Done" onPress={() => router.back()} />
        ) : status === 'pending' || status === 'phone-signed' ? (
          <Button label="Reject" variant="ghost" onPress={reject} />
        ) : null
      }
    >
      <TopBar />
      <Txt size={15} color={status === 'landed' ? colors.muted : colors.amber}>
        {status === 'landed' ? 'Manager key signed it' : `${req.agent} tried something its key cannot do`}
      </Txt>
      <Txt size={32} weight="bold" lineHeight={36} style={styles.title}>
        {title}
      </Txt>

      <View style={styles.amount}>
        <Txt mono size={48} weight="bold" lineHeight={56} color={status === 'landed' ? colors.text : colors.amber}>
          {usdc(req.amountUsdc)}
        </Txt>
        <Txt size={17} color={colors.text}>
          {req.decoded}
        </Txt>
        <Txt mono size={13} color={colors.muted}>
          {shortAddr(req.to, 10, 8)}
        </Txt>
      </View>

      <View style={styles.facts}>
        <Fact label="Key" value={req.agent} mono={false} />
        <Fact label="Left under its cap" value={usdc(headroom)} />
        <Fact label="Chain said" value="rejected, over cap" mono={false} color={colors.red} />
        <Fact label="Needs" value="phone and wrist" mono={false} />
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void tap();
          setShowRaw((v) => !v);
        }}
        style={styles.rawToggle}
      >
        <Txt size={14} color={colors.muted}>
          {showRaw ? 'Hide raw calldata' : 'Show raw calldata'}
        </Txt>
      </Pressable>
      {showRaw ? (
        <View style={styles.raw}>
          <Txt mono size={11} lineHeight={16} color={colors.muted}>
            {req.calldata}
          </Txt>
          <Txt size={13} color={colors.faint}>
            The wrist renders its readout from these bytes, not from what the agent claims.
          </Txt>
        </View>
      ) : null}

      {!settled ? (
        <View style={styles.sign}>
          <ManagerSign
            action="Sign it anyway"
            phoneDetail="Unlock to sign with the phone shard"
            wrist={state.wrist}
            onPhoneSigned={() => dispatch({ type: 'SIGN_UPDATE', id: req.id, status: 'phone-signed' })}
            onDone={() => dispatch({ type: 'SIGN_UPDATE', id: req.id, status: 'signed' })}
          />
        </View>
      ) : status === 'landed' ? (
        <Txt size={15} color={colors.muted} style={styles.after}>
          This did not count against the agent&apos;s cap. Its key is untouched, and the next over-cap attempt will ask
          again.
        </Txt>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 4 },
  amount: { marginTop: space.l, gap: space.s },
  facts: { marginTop: space.l },
  rawToggle: { paddingVertical: 12 },
  raw: { padding: space.m, backgroundColor: colors.panel, borderRadius: radius.m, gap: space.s },
  sign: { marginTop: space.l },
  after: { marginTop: space.l },
});
