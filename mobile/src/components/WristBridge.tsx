import { useEffect, useRef } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { link } from '../lib/link';
import { buzz } from '../lib/haptics';
import { revokeAllOnChain } from '../lib/chainRevoke';
import { useStore } from '../store/store';

/**
 * Keeps the store in step with the real wrist: link state, battery, wear, pairing,
 * and revokes started on the wrist. The allowance readout comes from the chain store.
 */
export function WristBridge() {
  const { state, dispatch } = useStore();
  const ready = Boolean(useRootNavigationState()?.key);
  const readyRef = useRef(ready);
  const addressRef = useRef(state.address);
  useEffect(() => {
    addressRef.current = state.address;
  }, [state.address]);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    link.start();
    const off = link.on((m) => {
      switch (m.t) {
        case 'hub':
          dispatch({
            type: 'WRIST',
            patch: { connected: Boolean(m.wrist), via: parseVia(m.via) },
          });
          break;
        case 'hello':
          dispatch({
            type: 'WRIST',
            patch: {
              connected: true,
              id: String(m.id),
              onArm: Boolean(m.onArm),
              battery: Number(m.battery),
              paired: Boolean(m.paired),
              groupKey: typeof m.groupKey === 'string' ? m.groupKey : null,
            },
          });
          break;
        case 'status':
          dispatch({
            type: 'WRIST',
            patch: {
              connected: true,
              onArm: Boolean(m.onArm),
              battery: Number(m.battery),
              paired: Boolean(m.paired),
              via: 'ble',
              ssid: typeof m.ssid === 'string' ? m.ssid : null,
            },
          });
          break;
        case 'dkg':
          dispatch({ type: 'WRIST', patch: { paired: true, groupKey: String(m.groupKey) } });
          break;
        case 'revoke_all':
          dispatch({ type: 'REVOKE_ALL' });
          // The wrist asked; the phone's shard alone signs the on-chain revokes.
          void revokeAllOnChain(addressRef.current);
          void buzz();
          if (readyRef.current) router.push('/revoke');
          break;
      }
    });
    return () => {
      off();
    };
  }, [dispatch]);

  // Pairing state can change on the wrist, so ask again whenever it comes back.
  useEffect(() => {
    if (state.wrist.connected) link.send({ t: 'hello?' });
  }, [state.wrist.connected]);

  // The allowance readout on the wrist comes from the real session (store/chain.tsx).

  return null;
}

function parseVia(v: unknown): 'ble' | 'relay' | 'wifi' | 'usb' | null {
  return v === 'ble' || v === 'relay' || v === 'wifi' || v === 'usb' ? v : null;
}

/** True when the wrist holds a share of this phone's wallet. */
export function wristMatches(wristKey: string | null, address: string | null): boolean {
  return Boolean(wristKey && address && wristKey.toLowerCase() === address.toLowerCase());
}
