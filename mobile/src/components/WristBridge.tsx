import { useEffect, useRef } from 'react';
import { router, useRootNavigationState } from 'expo-router';
import { link } from '../lib/link';
import { buzz } from '../lib/haptics';
import { useExposure, useStore } from '../store/store';

/**
 * Keeps the store in step with the real wrist: link state, battery, wear, pairing,
 * and revokes started on the wrist. Sends the exposure readout back to it.
 */
export function WristBridge() {
  const { state, dispatch } = useStore();
  const { live, cap, spent } = useExposure();
  const ready = Boolean(useRootNavigationState()?.key);
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  useEffect(() => {
    link.start();
    const offState = link.onState((open) => {
      if (!open) dispatch({ type: 'WRIST', patch: { hub: false, connected: false } });
      else dispatch({ type: 'WRIST', patch: { hub: true } });
    });
    const off = link.on((m) => {
      switch (m.t) {
        case 'hub':
          dispatch({ type: 'WRIST', patch: { hub: true, connected: Boolean(m.wrist) } });
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
            patch: { connected: true, onArm: Boolean(m.onArm), battery: Number(m.battery), paired: Boolean(m.paired) },
          });
          break;
        case 'dkg':
          dispatch({ type: 'WRIST', patch: { paired: true, groupKey: String(m.groupKey) } });
          break;
        case 'revoke_all':
          dispatch({ type: 'REVOKE_ALL' });
          void buzz();
          if (readyRef.current) router.push('/revoke');
          break;
      }
    });
    return () => {
      off();
      offState();
    };
  }, [dispatch]);

  // Pairing state can change on the wrist, so ask again whenever it comes back.
  useEffect(() => {
    if (state.wrist.connected) link.send({ t: 'hello?' });
  }, [state.wrist.connected]);

  useEffect(() => {
    if (!state.wrist.connected || !state.onboarded) return;
    const r2 = (n: number) => Math.round(n * 100) / 100;
    link.send({ t: 'exposure', left: r2(Math.max(cap - spent, 0)), cap: r2(cap), spent: r2(spent), keys: live.length });
  }, [cap, spent, live.length, state.wrist.connected, state.onboarded]);

  return null;
}

/** True when the wrist holds a share of this phone's wallet. */
export function wristMatches(wristKey: string | null, address: string | null): boolean {
  return Boolean(wristKey && address && wristKey.toLowerCase() === address.toLowerCase());
}
