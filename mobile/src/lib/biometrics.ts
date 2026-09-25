import * as LocalAuthentication from 'expo-local-authentication';

export type UnlockResult =
  | { ok: true; method: 'biometric' | 'passcode' | 'none' }
  | { ok: false; reason: string };

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Gate access to the phone shard. On devices without enrolled biometrics
 * (most simulators) this falls through after a short delay so demos never stall.
 */
/**
 * EXPO_PUBLIC_AUTOTEST=1 skips the fingerprint so the whole flow can be driven by a script.
 * The app shows a banner whenever it is on. Never ship with it set.
 */
export const AUTOTEST = process.env.EXPO_PUBLIC_AUTOTEST === '1';

export async function unlockShard(prompt: string): Promise<UnlockResult> {
  if (AUTOTEST) {
    await wait(300);
    return { ok: true, method: 'none' };
  }
  try {
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = hw && (await LocalAuthentication.isEnrolledAsync());
    if (!hw || !enrolled) {
      await wait(700);
      return { ok: true, method: 'none' };
    }
    const r = await LocalAuthentication.authenticateAsync({
      promptMessage: prompt,
      cancelLabel: 'Cancel',
    });
    if (r.success) return { ok: true, method: 'biometric' };
    if (r.error === 'user_cancel' || r.error === 'app_cancel' || r.error === 'system_cancel') {
      return { ok: false, reason: 'Cancelled' };
    }
    return { ok: false, reason: 'Could not verify you. Try again.' };
  } catch {
    await wait(500);
    return { ok: true, method: 'none' };
  }
}

export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}
