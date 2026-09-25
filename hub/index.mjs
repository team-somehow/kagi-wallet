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

// ---- devices: the wrist and the vault, over whichever links they are using -------
//
// Every link (USB port, local-network socket, relay WebSocket) learns which device is on
// it from that device's hello ("role": "wrist" or "vault"). Each role talks through its
// best link: relay, then local network, then USB. Phone messages go to the wrist unless
// they say "to": "vault"; vault messages reach the phone tagged "from": "vault".

const RANK = { relay: 3, wifi: 2, usb: 1 };
const links = new Set(); // { kind, name, role, write(line) }
let lastStatus = {};

function best(role) {
  let top = null;
  for (const l of links) if (l.role === role && (!top || RANK[l.kind] > RANK[top.kind])) top = l;
  return top;
}

const via = (role = 'wrist') => best(role)?.kind ?? null;
const hubStatus = () => ({ t: 'hub', wrist: best('wrist') !== null, via: via('wrist'), vault: best('vault') !== null, vaultVia: via('vault') });

function toDevice(role, line) {
  const l = best(role);
  if (!l) return false;
  l.write(line);
  return true;
}
const toWrist = (line) => toDevice('wrist', line);

function fromDevice(link, line) {
  if (!line.startsWith('{')) {
    if (line) log(`${link.role ?? 'device'} log (${link.kind})`, short(line));
    return;
  }
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.t === 'hello' && m.role !== link.role) {
    link.role = m.role === 'vault' ? 'vault' : 'wrist';
    log(`${link.name} is the ${link.role}`);
    broadcastPhones(hubStatus());
  }
  const role = link.role ?? 'wrist';
  // Only the link that device is actually using speaks for it.
  if (best(role) !== link) return;
  if (m.t === 'status') {
    const key = line.replace(/"battery":\d+,?/, '');
    if (key !== lastStatus[role]) {
      lastStatus[role] = key;
      log(`${role} (${link.kind}) status`, short(line));
    }
  } else {
    log(`${role} (${link.kind}) →`, short(line));
  }
  // A device can address the other device directly, e.g. the wrist's reshare piece for the vault.
  if (m.to === 'vault' && role === 'wrist') {
    if (!toDevice('vault', line)) log('no vault to deliver to');
    return;
  }
  broadcastPhones(role === 'vault' ? JSON.stringify({ ...m, from: 'vault' }) : line);
}

function lineReader(link) {
  let buf = '';
  return (chunk) => {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      fromDevice(link, line);
    }
  };
}

function addLink(link) {
  links.add(link);
  log(`${link.name} connected`);
  link.write(JSON.stringify({ t: 'hello?' }));
  broadcastPhones(hubStatus());
}

function dropLink(link) {
  if (!links.delete(link)) return;
  log(`${link.name} (${link.role ?? 'unknown'}) left`);
  broadcastPhones(hubStatus());
  for (const r of ['wrist', 'vault']) if (best(r)) best(r).write(JSON.stringify({ t: 'hello?' }));
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

  if (url.pathname === '/wrist' || url.pathname === '/vault') {
    const link = {
      kind: 'relay',
      name: `relay ${where}`,
      role: url.pathname === '/vault' ? 'vault' : null,
      write: (line) => ws.readyState === 1 && ws.send(line),
    };
    addLink(link);
    let last = Date.now();
    ws.on('message', (m) => {
      last = Date.now();
      for (const line of m.toString().split('\n')) fromDevice(link, line.trim());
    });
    const ping = setInterval(() => {
      if (Date.now() - last > 15000) ws.terminate();
    }, 5000);
    ws.on('close', () => {
      clearInterval(ping);
      dropLink(link);
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
    // Chain requests are handled here; everything else goes to a device.
    if (line.includes('"t":"evm_')) return void handleEvm(ws, line);
    const role = line.includes('"to":"vault"') ? 'vault' : 'wrist';
    if (!toDevice(role, line)) ws.send(JSON.stringify(hubStatus()));
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
    const run = async (label, fn) => {
      log(label);
      const r = await fn();
      if (r.hash) log(`  ${r.status ?? 'sent'} ${evm.EXPLORER}/tx/${r.hash}`);
      return reply(r);
    };
    switch (msg.t) {
      case 'evm_info?':
        return reply(await evm.info(gk));
      case 'evm_deploy':
        return await run('deploying a Leash account on Sepolia', () => evm.deploy(gk, msg.phoneKey, msg.fund ?? '0'));
      case 'evm_agent_key?':
        return reply(evm.agentKey(msg.name));
      case 'evm_grant':
        return await run(`granting a session key to ${msg.name ?? 'an agent'}`, () => evm.grant(gk, msg));
      case 'evm_revoke':
        return await run('revoking a session key (phone shard alone)', () => evm.revoke(gk, msg));
      case 'evm_agent_spend':
        return await run('the agent is spending on its own', () => evm.agentSpend(gk, msg));
      case 'evm_submit':
        return await run('submitting a call signed by phone and wrist', () => evm.submit(gk, msg));
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
    sock.setNoDelay(true);
    sock.setKeepAlive(true, 5000);
    const link = { kind: 'wifi', name: `local network ${who}`, role: null, write: (line) => sock.write(`${line}\n`) };
    addLink(link);
    const read = lineReader(link);
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
      dropLink(link);
    });
    sock.on('error', () => undefined);
  })
  .listen(TCP_PORT, '0.0.0.0');

// ---- USB ---------------------------------------------------------------------

const usb = new Map(); // path -> port

async function connectSerial() {
  const ports = await SerialPort.list();
  for (const p of ports) {
    if ((p.vendorId ?? '').toLowerCase() !== ESPRESSIF || usb.has(p.path)) continue;
    const port = new SerialPort({ path: p.path, baudRate: 115200, autoOpen: false, hupcl: false });
    usb.set(p.path, port);
    const link = { kind: 'usb', name: `usb ${p.path}`, role: null, write: (line) => port.isOpen && port.write(`${line}\n`) };
    port.open((err) => {
      if (err) {
        usb.delete(p.path);
        return log('usb open failed', p.path, err.message);
      }
      addLink(link);
      sendHint();
    });
    port.on('data', lineReader(link));
    port.on('close', () => {
      usb.delete(p.path);
      dropLink(link);
    });
    port.on('error', (e) => log('usb error', e.message));
  }
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
  for (const l of links) {
    // The vault only learns the relay for its own path.
    if (l.role === 'vault' && relay) l.write(JSON.stringify({ ...hint, relay: relay.replace('/wrist?', '/vault?') }));
    else l.write(line);
  }
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
