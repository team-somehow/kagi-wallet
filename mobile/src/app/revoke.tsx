import React from 'react';
import { Linking, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Txt } from '../components/Txt';
import { Button } from '../components/Button';
import { useStore } from '../store/store';
import { useChain } from '../store/chain';
import { revokeAllOnChain, useRevocation } from '../lib/chainRevoke';
import { EXPLORER } from '../lib/evm';
import { colors, space } from '../theme';
import { goBack } from '../lib/nav';

export default function Revoked() {
  const { state } = useStore();
  const { refresh } = useChain();
  const r = useRevocation();
  const done = r.phase === 'done';
  return (
    <Screen
      footer={
        <Button
          label="Back to wallet"
          onPress={() => {
            void refresh();
            goBack();
          }}
        />
      }
    >
      <View style={{ marginTop: space.xxl, gap: space.l }}>
        <Txt size={32} weight="bold" lineHeight={38}>
          {done
            ? 'Agent access stopped'
            : r.phase === 'error'
              ? 'Revocation needs attention'
              : r.phase === 'idle'
                ? 'Revoke agent access'
                : 'Stopping agent access'}
        </Txt>
        <Txt size={17} color={colors.muted}>
          {done
            ? `${r.confirmed} ${r.confirmed === 1 ? 'key revoked' : 'keys revoked'} in this run. No saved active session keys remain.`
            : 'Keys can still spend until their revocation confirms on-chain. Keep this phone connected.'}
        </Txt>
        {r.error ? <Txt color={colors.amber}>{r.error}</Txt> : null}
        {r.hash ? (
          <Button
            label="Track transaction"
            variant="secondary"
            onPress={() => void Linking.openURL(`${EXPLORER}/tx/${r.hash}`)}
          />
        ) : null}
        {r.phase === 'error' || r.phase === 'idle' ? (
          <Button label="Check and retry" onPress={() => void revokeAllOnChain(state.address).then(() => refresh())} />
        ) : null}
        <Txt size={14} color={colors.muted}>
          The phone can revoke access by itself. Granting more access still needs your devices.
        </Txt>
      </View>
    </Screen>
  );
}
