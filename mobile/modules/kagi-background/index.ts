import { requireOptionalNativeModule } from 'expo-modules-core';

interface Native {
  start(title: string, text: string): void;
  update(title: string, text: string): void;
  stop(): void;
  isRunning(): boolean;
  alert(id: number, title: string, text: string, uri: string): void;
  clearAlert(id: number): void;
}

// Missing in Expo Go, on iOS, and in builds made before this module: every call is then a no-op.
const native = requireOptionalNativeModule<Native>('KagiBackground');

export const available = native != null;
export const start = (title: string, text: string) => native?.start(title, text);
export const update = (title: string, text: string) => native?.update(title, text);
export const stop = () => native?.stop();
export const isRunning = () => native?.isRunning() ?? false;
export const alert = (id: number, title: string, text: string, uri: string) => native?.alert(id, title, text, uri);
export const clearAlert = (id: number) => native?.clearAlert(id);
