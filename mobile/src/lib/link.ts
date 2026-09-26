/**
 * The phone's link to the sticks: Bluetooth LE only (lib/ble.ts). The phone talks to
 * the chain itself (lib/evm.ts), so there is no hub.
 * Both sticks are merged into one message stream. Vault messages carry "from": "vault", and
 * a {t: "hub"} status (name kept for the listeners) reports which sticks are connected.
 */
import { ble, type Role } from './ble';

export type Msg = { t: string; [k: string]: unknown };
type Listener = (m: Msg) => void;

class Link {
  private listeners = new Set<Listener>();
  private started = false;

  start() {
    if (this.started) return;
    this.started = true;
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
    // The Kagi Wallet can address the vault directly (its reshare piece). Pass it on.
    if (role === 'wrist' && m.to === 'vault') {
      this.send(m);
      return;
    }
    if (role === 'vault') m.from = 'vault';
    this.listeners.forEach((l) => l(m));
  }

  private emitDevices() {
    const b = ble.state();
    const s: Msg = { t: 'hub', wrist: b.wrist, via: b.wrist ? 'ble' : null, vault: b.vault, vaultVia: b.vault ? 'ble' : null };
    this.listeners.forEach((l) => l(s));
  }

  /** Send to the Kagi Wallet, or to the vault when m.to is "vault". False if that stick is not connected. */
  send(m: Msg): boolean {
    const role: Role = m.to === 'vault' ? 'vault' : 'wrist';
    if (!ble.state()[role]) return false;
    void ble.send(role, JSON.stringify(m)).then((ok) => {
      if (!ok) this.listeners.forEach((l) => l({ t: 'delivery_error', role, request: m.t, id: m.id }));
    });
    return true;
  }

  on(l: Listener) {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** Resolve with the first message matching pred, reject after ms. */
  waitFor<T extends Msg = Msg>(pred: (m: Msg) => boolean, ms: number, what = 'the Kagi Wallet'): Promise<T> {
    const promise = new Promise<T>((resolve, reject) => {
      const off = this.on((m) => {
        if (m.t === 'delivery_error') {
          off(); clearTimeout(timer); reject(new Error(`Lost the ${String(m.role)} connection. Reconnect and retry.`)); return;
        }
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
    // Some callers leave before awaiting a response (cancel/disconnect). Preserve rejection for
    // awaiting callers while preventing an abandoned response from becoming unhandled.
    void promise.catch(() => {});
    return promise;
  }
}

export const link = new Link();
