// Leash hub. Stand-in for the agent server: the wrist is on USB serial, the phone app
// connects over WebSocket (via `adb reverse tcp:8787 tcp:8787`). Lines pass through unchanged.
import { SerialPort } from 'serialport';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.HUB_PORT ?? 8787);
const ESPRESSIF = '303a';

const wss = new WebSocketServer({ port: PORT });
let serial = null;
let buf = '';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const short = (s) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);

function broadcast(obj) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  for (const c of wss.clients) if (c.readyState === 1) c.send(s);
}

function toWrist(line) {
  if (!serial?.isOpen) return false;
  serial.write(`${line}\n`);
  return true;
}

async function findWrist() {
  const ports = await SerialPort.list();
  return ports.find((p) => (p.vendorId ?? '').toLowerCase() === ESPRESSIF)?.path ?? null;
}

async function connect() {
  if (serial?.isOpen) return;
  const path = process.env.WRIST_PORT ?? (await findWrist());
  if (!path) return;
  const port = new SerialPort({ path, baudRate: 115200, autoOpen: false, hupcl: false });
  port.open((err) => {
    if (err) return log('wrist open failed', err.message);
    serial = port;
    log('wrist connected on', path);
    broadcast({ t: 'hub', wrist: true });
    toWrist(JSON.stringify({ t: 'hello?' }));
  });
  port.on('data', (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) {
        if (line) log('wrist log', short(line));
        continue;
      }
      if (!line.includes('"status"')) log('wrist →', short(line));
      broadcast(line);
    }
  });
  port.on('close', () => {
    log('wrist disconnected');
    serial = null;
    broadcast({ t: 'hub', wrist: false });
  });
  port.on('error', (e) => log('wrist error', e.message));
}

wss.on('connection', (ws) => {
  log('phone connected');
  ws.send(JSON.stringify({ t: 'hub', wrist: Boolean(serial?.isOpen) }));
  toWrist(JSON.stringify({ t: 'hello?' }));
  ws.on('message', (m) => {
    const line = m.toString();
    if (!line.includes('"ping"')) log('phone →', short(line));
    if (!toWrist(line)) ws.send(JSON.stringify({ t: 'hub', wrist: false }));
  });
  ws.on('close', () => log('phone disconnected'));
});

setInterval(connect, 1000);
connect();
log(`hub listening on ws://localhost:${PORT}`);
