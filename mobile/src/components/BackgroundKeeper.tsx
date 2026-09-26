import { useEffect, useRef } from 'react';
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import * as bg from '../../modules/kagi-background';
import { endBackgroundTask } from '../../background';
import { useStore } from '../store/store';
import { useChain } from '../store/chain';

/**
 * Keeps Kagi running while you are in another app: a foreground service with an ongoing
 * notification, so the stick stays connected and limit requests still reach you.
 */
export function BackgroundKeeper() {
  const { state } = useStore();
  const { live } = useChain();
  const on = state.onboarded;
  const title = 'Kagi is watching your agents';
  const text = `${state.wrist.connected ? 'Stick connected' : 'Stick not connected'}. ${live.length === 1 ? '1 agent key' : `${live.length} agent keys`} live.`;
  // The start below waits on a permission prompt; it must show what is true when it lands.
  const latest = useRef(text);
  useEffect(() => {
    latest.current = text;
  }, [text]);

  // Start once there is a wallet to protect; stop when it is gone. Android only lets the app start
  // it while it is on screen, so try again each time the app comes to the front.
  useEffect(() => {
    if (Platform.OS !== 'android' || !bg.available) return;
    if (!on) {
      if (bg.isRunning()) bg.stop();
      endBackgroundTask();
      return;
    }
    let asked = false;
    const ensure = async () => {
      if (AppState.currentState !== 'active' || bg.isRunning()) return;
      // Android 13+ hides notifications until allowed, including the request alerts.
      if (!asked && Number(Platform.Version) >= 33) {
        asked = true;
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
      }
      try {
        bg.start(title, latest.current);
      } catch {
        // Refused, e.g. behind the lock screen: the next time the app is in front tries again.
      }
    };
    void ensure();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void ensure();
    });
    return () => sub.remove();
  }, [on]);

  useEffect(() => {
    if (on && bg.available && bg.isRunning()) bg.update(title, text);
  }, [on, text]);

  return null;
}
