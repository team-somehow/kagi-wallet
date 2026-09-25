// Leash hub. Stand-in for the agent server, and the relay between phone and wrist.
//
// The wrist reaches it by, in order of preference on the wrist:
//   - WebSocket through the public tunnel:  wss://<tunnel>/wrist?token=...   (any network)
//   - TCP on the local network:             <laptop>:8788                    (same network)
//   - USB serial                                                             (plugged in)
// The phone reaches it by WebSocket: through the tunnel (wss://<tunnel>/phone?token=...),
// on the local network, or over `adb reverse tcp:8787 tcp:8787`.
//
// `node index.mjs --tunnel` also opens free Cloudflare quick tunnels for the hub and for
// Metro, and writes their addresses to .public.json for scripts/online.sh.
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialPort } from 'serialport';
import { WebSocketServer } from 'ws';
import * as evm from './evm.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WS_PORT = Number(process.env.HUB_PORT ?? 8787);
const TCP_PORT = Number(process.env.HUB_WRIST_PORT ?? 8788);
const METRO_PORT = Number(process.env.METRO_PORT ?? 8081);
const TUNNEL = process.argv.includes('--tunnel');
const ESPRESSIF = '303a';

// Anything arriving through the public tunnel must carry this token.
const TOKEN_FILE = join(HERE, '.token');
if (!existsSync(TOKEN_FILE)) writeFileSync(TOKEN_FILE, randomBytes(16).toString('hex'), { mode: 0o600 });
const TOKEN = readFileSync(TOKEN_FILE, 'utf8').trim();

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const short = (s) => (s.length > 140 ? `${s.slice(0, 140)}…` : s);

let publicHub = null; // https://....trycloudflare.com
let publicMetro = null;

// ---- the wrist, over whichever link it is using -----------------------------

let serial = null;
let tcp = null; // local network socket
let wsWrist = null; // WebSocket, local or through the tunnel
let lastStatus = '';

const via = () => (wsWrist ? 'relay' : tcp ? 'wifi' : serial?.isOpen ? 'usb' : null);
const hubStatus = () => ({ t: 'hub', wrist: via() !== null, via: via() });

function toWrist(line) {
  if (wsWrist?.readyState === 1) return wsWrist.send(line), true;
  if (tcp) return tcp.write(`${line}\n`), true;
  if (serial?.isOpen) return serial.write(`${line}\n`), true;
  return false;
}

function fromWrist(line, source) {
  if (!line.startsWith('{')) {
    if (line) log(`wrist log (${source})`, short(line));
    return;
  }
  // Only the link the wrist is actually using speaks for it.
  if (source !== via()) return;
  if (!line.includes('"status"')) log(`wrist (${source}) →`, short(line));
  else if (line.replace(/"battery":\d+,?/, '') !== lastStatus) {
    lastStatus = line.replace(/"battery":\d+,?/, '');
    log(`wrist (${source}) status`, short(line));
  }
  broadcastPhones(line);
}

function lineReader(source) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      fromWrist(line, source);
    }
  };
}

function wristChanged(what) {
  log(what, `(now via ${via() ?? 'nothing'})`);
  broadcastPhones(hubStatus());
  toWrist(JSON.stringify({ t: 'hello?' }));
}

// ---- phones ------------------------------------------------------------------

const phones = new Set();
function broadcastPhones(obj) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  for (const c of phones) if (c.readyState === 1) c.send(s);
}

// ---- WebSocket server: /phone and /wrist ------------------------------------

function tokenOk(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

const wss = new WebSocketServer({ port: WS_PORT });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://x');
  // Cloudflare adds cf-ray to everything it forwards. Local connections have none.
  const remote = Boolean(req.headers['cf-ray']);
  if (remote && !tokenOk(url.searchParams.get('token'))) {
    log('refused a connection through the tunnel with a bad token');
    ws.close(4401, 'bad token');
    return;
  }
  const where = remote ? 'through the tunnel' : 'locally';

  if (url.pathname === '/wrist') {
    if (wsWrist) wsWrist.close();
    wsWrist = ws;
    wristChanged(`wrist connected ${where}`);
    let last = Date.now();
    ws.on('message', (m) => {
      last = Date.now();
      for (const line of m.toString().split('\n')) fromWrist(line.trim(), 'relay');
    });
    const ping = setInterval(() => {
      if (Date.now() - last > 15000) ws.terminate();
    }, 5000);
    ws.on('close', () => {
      clearInterval(ping);
      if (wsWrist === ws) {
        wsWrist = null;
        wristChanged('wrist left the relay');
      }
    });
    ws.on('error', () => undefined);
    return;
  }

  phones.add(ws);
  log(`phone connected ${where}`);
  ws.send(JSON.stringify(hubStatus()));
  toWrist(JSON.stringify({ t: 'hello?' }));
  ws.on('message', (m) => {
    const line = m.toString();
    if (!line.includes('"ping"')) log('phone →', short(line));
    // Chain requests are handled here; everything else is for the wrist.
    if (line.includes('"t":"evm_')) return void handleEvm(ws, line);
    if (!toWrist(line)) ws.send(JSON.stringify(hubStatus()));
  });
  ws.on('close', () => {
    phones.delete(ws);
    log('phone disconnected');
  });
  ws.on('error', () => undefined);
});

async function handleEvm(ws, line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const reply = (o) => ws.readyState === 1 && ws.send(JSON.stringify({ ...o, reqId: msg.reqId }));
  const gk = String(msg.groupKey ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(gk)) return reply({ t: 'evm_error', reason: 'bad group key' });
  try {
    if (msg.t === 'evm_info?') return reply(await evm.info(gk));
    if (msg.t === 'evm_deploy') {
      log('deploying a Leash account on Sepolia');
      const r = await evm.deploy(gk, msg.fund ?? '0');
      log('deployed', r.account, `${evm.EXPLORER}/tx/${r.hash}`);
      return reply(r);
    }
    if (msg.t === 'evm_submit') {
      log('submitting a signed call on Sepolia');
      const r = await evm.submit(gk, msg);
      log('landed', r.status, `${evm.EXPLORER}/tx/${r.hash}`);
      return reply(r);
    }
  } catch (e) {
    const reason = e?.shortMessage ?? e?.message ?? String(e);
    log('evm error', reason);
    reply({ t: 'evm_error', reason: reason.split('\n')[0] });
  }
}

// ---- local network TCP -------------------------------------------------------

net
  .createServer((sock) => {
    const who = `${sock.remoteAddress?.replace('::ffff:', '')}:${sock.remotePort}`;
    if (tcp) tcp.destroy();
    tcp = sock;
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 5000);
    wristChanged(`wrist connected on the local network from ${who}`);
    const read = lineReader('wifi');
    let last = Date.now();
    sock.on('data', (d) => {
      last = Date.now();
      read(d);
    });
    const ping = setInterval(() => {
      sock.write('{"t":"hub_ping"}\n');
      if (Date.now() - last > 10000) sock.destroy();
    }, 4000);
    sock.on('close', () => {
      clearInterval(ping);
      if (tcp !== sock) return;
      tcp = null;
      wristChanged('wrist left the local network');
    });
    sock.on('error', () => undefined);
  })
  .listen(TCP_PORT, '0.0.0.0');

// ---- USB ---------------------------------------------------------------------

async function connectSerial() {
  if (serial?.isOpen) return;
  const ports = await SerialPort.list();
  const path = process.env.WRIST_PORT ?? ports.find((p) => (p.vendorId ?? '').toLowerCase() === ESPRESSIF)?.path;
  if (!path) return;
  const port = new SerialPort({ path, baudRate: 115200, autoOpen: false, hupcl: false });
  port.open((err) => {
    if (err) return log('usb open failed', err.message);
    serial = port;
    wristChanged(`wrist on usb at ${path}`);
    sendHint();
  });
  port.on('data', lineReader('usb'));
  port.on('close', () => {
    serial = null;
    wristChanged('wrist left usb');
  });
  port.on('error', (e) => log('usb error', e.message));
}
setInterval(connectSerial, 1000);
connectSerial();

// ---- telling the wrist where to find us ---------------------------------------

function lanAddress() {
  return (
    Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254'))?.address ?? null
  );
}

function wristRelayUrl() {
  return publicHub ? `${publicHub.replace('https://', 'wss://')}/wrist?token=${TOKEN}` : null;
}

// Sent over every link the wrist is on, so it can find us next time from anywhere.
function sendHint() {
  const hint = { t: 'hub_hint', host: lanAddress() };
  const relay = wristRelayUrl();
  if (relay) hint.relay = relay;
  const line = JSON.stringify(hint);
  if (serial?.isOpen) serial.write(`${line}\n`);
  if (tcp) tcp.write(`${line}\n`);
  if (wsWrist?.readyState === 1) wsWrist.send(line);
}
setInterval(sendHint, 5000);

// ---- public tunnels ------------------------------------------------------------

function quickTunnel(port, name) {
  return new Promise((resolve) => {
    const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onData = (d) => {
      const m = d.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) resolve(m[0]);
    };
    cf.stdout.on('data', onData);
    cf.stderr.on('data', onData);
    cf.on('exit', (code) => log(`${name} tunnel exited (${code})`));
    process.on('exit', () => cf.kill());
    process.on('SIGINT', () => process.exit(0));
    process.on('SIGTERM', () => process.exit(0));
  });
}

log(`hub up. phone: ws://localhost:${WS_PORT}  wrist: tcp ${lanAddress() ?? '?'}:${TCP_PORT}`);

if (TUNNEL) {
  const [hubUrl, metroUrl] = await Promise.all([quickTunnel(WS_PORT, 'hub'), quickTunnel(METRO_PORT, 'metro')]);
  publicHub = hubUrl;
  publicMetro = metroUrl;
  const phoneUrl = `${publicHub.replace('https://', 'wss://')}/phone?token=${TOKEN}`;
  writeFileSync(join(HERE, '.public.json'), JSON.stringify({ hub: publicHub, metro: publicMetro, phoneUrl }, null, 2), {
    mode: 0o600,
  });
  log(`public hub   ${publicHub}`);
  log(`public metro ${publicMetro}`);
  sendHint();
}
