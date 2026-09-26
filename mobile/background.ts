// Runs before the app: registers the task the background service keeps alive. It has to be
// here, not in a screen, because Android can restart the service without opening any screen.
import { AppRegistry } from 'react-native';

let finish: (() => void) | null = null;

/** Ends the background task, so React Native stops treating the app as busy. */
export function endBackgroundTask() {
  finish?.();
  finish = null;
}

AppRegistry.registerHeadlessTask('KagiBackground', () => () =>
  new Promise<void>((resolve) => {
    // Never resolves on its own: while it is pending, timers and Bluetooth keep running.
    finish = resolve;
  }),
);
