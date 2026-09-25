/**
 * WebSocket link to the hub on the laptop, which relays to the wrist over USB serial.
 * On a USB-connected Android phone, `adb reverse tcp:8787 tcp:8787` makes localhost work.
 */
import Constants from 'expo-constants';

export type Msg = { t: string; [k: string]: unknown };
type Listener = (m: Msg) => void;
type StateListener = (open: boolean) => void;

/**
 * The hub runs on the same laptop that serves the app, so use whatever host the app
 * was loaded from: the laptop's WiFi address on a phone over the network, or localhost
 * through `adb reverse`. EXPO_PUBLIC_HUB_URL overrides it.
 */
function hubUrl(): string {
  if (process.env.EXPO_PUBLIC_HUB_URL) return process.env.EXPO_PUBLIC_HUB_URL;
  const hostUri = Constants.expoConfig?.hostUri ?? '';
  const host = hostUri.split(':')[0];
  return `ws://${host || 'localhost'}:8787`;
}

const URL = hubUrl();

class Link {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<StateListener>();
  private started = false;
  private ping: ReturnType<typeof setInterval> | null = null;
  open = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  private connect() {
    const ws = new WebSocket(URL);
    this.ws = ws;
    ws.onopen = () => {
      this.setOpen(true);
      this.send({ t: 'hello?' });
      this.ping = setInterval(() => this.send({ t: 'ping' }), 3000);
    };
    ws.onmessage = (e) => {
      let m: Msg;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (typeof m?.t !== 'string') return;
      this.listeners.forEach((l) => l(m));
    };
    ws.onclose = () => {
      if (this.ping) clearInterval(this.ping);
      this.ping = null;
      this.ws = null;
      this.setOpen(false);
      setTimeout(() => this.connect(), 1500);
    };
    ws.onerror = () => undefined;
  }

  private setOpen(v: boolean) {
    this.open = v;
    this.stateListeners.forEach((l) => l(v));
  }

  send(m: Msg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(m));
    return true;
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  onState(l: StateListener) {
    this.stateListeners.add(l);
    return () => {
      this.stateListeners.delete(l);
    };
  }

  /** Resolve with the first message matching pred, reject after ms. */
  waitFor<T extends Msg = Msg>(pred: (m: Msg) => boolean, ms: number, what = 'the wrist'): Promise<T> {
    return new Promise((resolve, reject) => {
      const off = this.on((m) => {
        if (!pred(m)) return;
        off();
        clearTimeout(timer);
        resolve(m as T);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`No answer from ${what}.`));
      }, ms);
    });
  }
}

export const link = new Link();
