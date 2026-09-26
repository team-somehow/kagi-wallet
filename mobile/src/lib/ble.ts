/**
 * Bluetooth LE link to the sticks. The only link: the phone talks to Sepolia itself.
 *
 * Each stick runs one GATT service (see firmware/wrist/src/ble.h): the phone writes lines to
 * RX, the stick notifies lines on TX. Lines are the same JSON as every other link, chunked to
 * the MTU and newline-terminated. The wrist advertises all the time; the vault only while its
 * 2-minute window is open.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, type Device, type Subscription } from 'react-native-ble-plx';

export const SERVICE = '6b616769-0000-4000-8000-00000000c0de';
const RX = '6b616769-0001-4000-8000-00000000c0de';
const TX = '6b616769-0002-4000-8000-00000000c0de';

export type Role = 'wrist' | 'vault';
type LineListener = (role: Role, line: string) => void;
type StateListener = (state: Record<Role, boolean>) => void;

// Tiny base64 for Uint8Array <-> string without extra dependencies.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}
function fromB64(s: string): Uint8Array {
  const clean = s.replace(/=+$/, '');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}
const utf8 = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

interface Conn {
  device: Device;
  mtu: number;
  buf: string;
  subs: Subscription[];
}

class Ble {
  private manager: BleManager | null = null;
  private conns: Partial<Record<Role, Conn>> = {};
  private connecting = new Set<string>();
  private lines = new Set<LineListener>();
  private states = new Set<StateListener>();
  private started = false;
  available = true;

  state(): Record<Role, boolean> {
    return { wrist: Boolean(this.conns.wrist), vault: Boolean(this.conns.vault) };
  }

  onLine(l: LineListener) {
    this.lines.add(l);
    return () => void this.lines.delete(l);
  }

  onState(l: StateListener) {
    this.states.add(l);
    return () => void this.states.delete(l);
  }

  private emitState() {
    const s = this.state();
    this.states.forEach((l) => l(s));
  }

  async start() {
    if (this.started) return;
    this.started = true;
    try {
      this.manager = new BleManager();
    } catch {
      // Expo Go or a build without the native module: no sticks.
      this.available = false;
      return;
    }
    if (Platform.OS === 'android') {
      const res = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      if (Object.values(res).some((v) => v !== PermissionsAndroid.RESULTS.GRANTED)) {
        this.available = false;
        return;
      }
    }
    this.manager.onStateChange((s) => {
      if (s === 'PoweredOn') this.scan();
    }, true);
  }

  private scanning = false;
  private rescanTimer: ReturnType<typeof setInterval> | null = null;

  /** Restart the scan: Android only reports a device once per scan, so do this after every disconnect. */
  private rescan() {
    if (!this.manager) return;
    void this.manager.stopDeviceScan().catch(() => undefined);
    this.scanning = false;
    this.scan();
  }

  private scan() {
    if (this.scanning || !this.manager) return;
    this.scanning = true;
    // Keep looking while a stick is missing: the vault only shows up while its window is open.
    if (!this.rescanTimer) this.rescanTimer = setInterval(() => {
      if (!this.conns.wrist || !this.conns.vault) this.rescan();
    }, 8000);
    this.manager.startDeviceScan([SERVICE], { allowDuplicates: false }, (err, d) => {
      if (err || !d) return;
      if (this.connecting.has(d.id) || Object.values(this.conns).some((c) => c?.device.id === d.id)) return;
      // The name may be missing (it rides in the scan response), so the stick's hello decides its role.
      void this.connect(d);
    });
  }

  private async connect(d: Device) {
    let role: Role | null = null;
    const m = this.manager!;
    const m2 = m;
    this.connecting.add(d.id);
    try {
      let dev = await m.connectToDevice(d.id, { timeout: 8000 });
      dev = await m.requestMTUForDevice(dev.id, 247).catch(() => dev);
      await m.discoverAllServicesAndCharacteristicsForDevice(dev.id);
      const conn: Conn = { device: dev, mtu: dev.mtu || 23, buf: '', subs: [] };
      conn.subs.push(
        m.monitorCharacteristicForDevice(dev.id, SERVICE, TX, (err, c) => {
          if (err || !c?.value) return;
          conn.buf += text(fromB64(c.value));
          let i;
          while ((i = conn.buf.indexOf('\n')) >= 0) {
            const line = conn.buf.slice(0, i).trim();
            conn.buf = conn.buf.slice(i + 1);
            if (!line) continue;
            if (!role) {
              try {
                const m = JSON.parse(line);
                if (m.t === 'hello') {
                  role = m.role === 'vault' ? 'vault' : 'wrist';
                  if (this.conns[role] && this.conns[role] !== conn) {
                    void m2.cancelDeviceConnection(conn.device.id);
                    return;
                  }
                  this.conns[role] = conn;
                  this.emitState();
                }
              } catch {
                // not JSON yet
              }
            }
            if (role) {
              const r = role;
              this.lines.forEach((l) => l(r, line));
            }
          }
        }),
      );
      conn.subs.push(
        m.onDeviceDisconnected(dev.id, () => {
          conn.subs.forEach((s) => s.remove());
          if (role && this.conns[role] === conn) delete this.conns[role];
          this.emitState();
          this.rescan();
        }),
      );
      await this.write(conn, JSON.stringify({ t: 'hello?' }));
    } catch {
      // Out of range or busy; look again.
      setTimeout(() => this.rescan(), 1500);
    } finally {
      this.connecting.delete(d.id);
    }
  }

  /** Write one line to a stick. Resolves false when that stick is not on Bluetooth. */
  async send(role: Role, line: string): Promise<boolean> {
    const c = this.conns[role];
    if (!c || !this.manager) return false;
    return this.write(c, line);
  }

  private writes = new WeakMap<Conn, Promise<boolean>>();
  private write(c: Conn, line: string): Promise<boolean> {
    // Queue complete frames, not individual MTU chunks. Independent sticks can write in parallel.
    const prior = this.writes.get(c) ?? Promise.resolve(true);
    const next = prior.catch(() => false).then(() => this.writeFrame(c, line));
    this.writes.set(c, next);
    return next;
  }
  private async writeFrame(c: Conn, line: string): Promise<boolean> {
    if (!this.manager) return false;
    const bytes = utf8(line.endsWith('\n') ? line : `${line}\n`);
    const chunk = Math.max(20, c.mtu - 3);
    try {
      for (let off = 0; off < bytes.length; off += chunk) {
        await this.manager.writeCharacteristicWithResponseForDevice(c.device.id, SERVICE, RX, toB64(bytes.slice(off, off + chunk)));
      }
      return true;
    } catch {
      return false;
    }
  }
}

export const ble = new Ble();
