import * as Haptics from 'expo-haptics';

const quiet = (p: Promise<void>) => p.catch(() => undefined);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const tap = () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const thud = () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
export const success = () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const warn = () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));

/** Three heavy pulses: the phone echo of the Kagi Wallet buzz. */
export async function buzz() {
  for (let i = 0; i < 3; i++) {
    await thud();
    await wait(140);
  }
}
