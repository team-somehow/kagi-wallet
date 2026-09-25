/**
 * The phone's link to the sticks and the hub.
 *   Sticks: Bluetooth LE first (lib/ble.ts); the hub (WiFi, relay or USB) as the fallback.
 *   Chain (evm_*) and limit requests (limit_*): always the hub.
 * Everything is merged into one message stream. Vault messages carry "from": "vault", and
 * the {t: "hub"} status reports a stick connected if it is up on either path.
 */
import Constants from 'expo-constants';
import { ble, type Role } from './ble';

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
  private hubDevices = { wrist: false, via: null as string | null, vault: false, vaultVia: null as string | null };
  open = false;

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
    void ble.start();
    ble.onLine((role, line) => this.fromBle(role, line));
    ble.onState(() => this.emitDevices());
  }

  /** A line from a stick over Bluetooth. */
  private fromBle(role: Role, line: string) {
    let m: Msg;
    try {
      m = JSON.parse(line);
    } catch {
      return;
    }
    // The wrist can address the vault directly (its reshare piece). Pass it on.
    if (role === 'wrist' && m.to === 'vault') {
      this.send(m);
      return;
    }
    if (role === 'vault') m.from = 'vault';
    this.listeners.forEach((l) => l(m));
  }

  private emitDevices() {
    const b = ble.state();
    const s: Msg = {
      t: 'hub',
      wrist: b.wrist || this.hubDevices.wrist,
      via: b.wrist ? 'ble' : this.hubDevices.via,
      vault: b.vault || this.hubDevices.vault,
      vaultVia: b.vault ? 'ble' : this.hubDevices.vaultVia,
    };
    this.listeners.forEach((l) => l(s));
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
      if (m.t === 'hub') {
        this.hubDevices = { wrist: Boolean(m.wrist), via: (m.via as string) ?? null, vault: Boolean(m.vault), vaultVia: (m.vaultVia as string) ?? null };
        return this.emitDevices();
      }
      // A stick that is on Bluetooth speaks for itself; ignore its copy through the hub.
      const b = ble.state();
      // Hub-originated events (limit requests, agent activity, chain replies) always pass.
      const fromHub = m.src === 'hub' || m.reqId !== undefined || String(m.t).startsWith('evm_');
      if (!fromHub && ((m.from === 'vault' && b.vault) || (m.from !== 'vault' && b.wrist))) return;
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
    const line = JSON.stringify(m);
    const t = String(m.t);
    if (!t.startsWith('evm_') && !t.startsWith('limit_')) {
      const role: Role = m.to === 'vault' ? 'vault' : 'wrist';
      if (ble.state()[role]) {
        void ble.send(role, line).then((ok) => {
          if (!ok) this.sendHub(line);
        });
        return true;
      }
    }
    return this.sendHub(line);
  }

  private sendHub(line: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(line);
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

  /** Send a request tagged with an id and resolve with the reply carrying the same id. */
  request<T extends Msg = Msg>(m: Msg, ms: number, what = 'the hub'): Promise<T> {
    const reqId = Math.random().toString(36).slice(2);
    const p = this.waitFor<T>((x) => x.reqId === reqId, ms, what);
    if (!this.send({ ...m, reqId })) return Promise.reject(new Error(`Not connected to ${what}.`));
    return p;
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

/** Where the agent chat is served: the same hub, over http. */
export const chatUrl = () => URL.replace(/^ws/, 'http').replace(/\/+$/, '');
