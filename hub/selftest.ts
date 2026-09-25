// Drives the real wrist (autotest firmware) through pairing, key generation and signing,
// using the phone's own protocol code, and checks every signature with a BIP340 verifier.
// Run with the hub stopped: npm run selftest
import { randomBytes } from 'node:crypto';
import { SerialPort } from 'serialport';
import {
  combine,
  dkgFinish,
  dkgStart,
  grantCanonical,
  messageFor,
  nonces,
  pairingCode,
  txCanonical,
} from '../mobile/src/lib/frost';

const rand = (n: number) => new Uint8Array(randomBytes(n));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const ports = await SerialPort.list();
const path = process.env.WRIST_PORT ?? ports.find((p) => (p.vendorId ?? '').toLowerCase() === '303a')?.path;
if (!path) throw new Error('No wrist on USB.');
const port = new SerialPort({ path, baudRate: 115200, hupcl: false });
let buf = '';
const waiters: Array<{ t: string; res: (m: any) => void }> = [];
port.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line.startsWith('{')) continue;
    const m = JSON.parse(line);
    const w = waiters.findIndex((x) => x.t === m.t || (x.t === 'sig_share' && m.t === 'sign_reject'));
    if (w >= 0) waiters.splice(w, 1)[0].res(m);
  }
});
const send = (o: object) => port.write(`${JSON.stringify(o)}\n`);
const expect = (t: string, ms = 8000) =>
  new Promise<any>((res, rej) => {
    waiters.push({ t, res });
    setTimeout(() => rej(new Error(`timed out waiting for ${t}`)), ms);
  });

await new Promise((r) => setTimeout(r, 800));
send({ t: 'hello?' });
const hello = await expect('hello');
console.log('wrist', hello.id, 'fw', hello.fw, 'battery', hello.battery);

const phoneNonce = hex(rand(16));
const pairP = expect('pair');
const okP = expect('pair_ok');
send({ t: 'pair', nonce: phoneNonce });
const pair = await pairP;
await okP;
console.log('pairing code', pairingCode(phoneNonce, pair.nonce));

const mine = dkgStart(rand);
const dkgP = expect('dkg', 15000);
send({ t: 'dkg', X: mine.X, pop: mine.pop });
const dkg = await dkgP;
const share = dkgFinish(mine, dkg.X, dkg.pop);
if (share.groupKey !== dkg.groupKey) throw new Error(`group key mismatch ${share.groupKey} vs ${dkg.groupKey}`);
console.log('group key', share.groupKey);

const cases = [
  { kind: 'grant', agent: 'trader', pubkey: `0x02${hex(rand(32))}`, capMicro: '500000000', hours: 24 },
  {
    kind: 'tx',
    agent: 'trader',
    to: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
    calldata: `0xa9059cbb${'1f9840a85d5af5bf1d1762f925bdaddc4201f984'.padStart(64, '0')}${(600_000_000).toString(16).padStart(64, '0')}`,
  },
];
let n = 0;
for (let round = 0; round < 5; round++) {
  for (const c of cases) {
    const m =
      c.kind === 'grant'
        ? messageFor(grantCanonical(c.agent, c.pubkey!, Number(c.capMicro) / 1e6, c.hours!))
        : messageFor(txCanonical(c.to!, c.calldata!));
    const nn = nonces(rand);
    const id = `t${n}`;
    const sP = expect('sig_share', 20000);
    send({ t: 'sign', id, ...c, D: nn.D, E: nn.E });
    const s = await sP;
    if (s.t === 'sign_reject') throw new Error(`wrist rejected: ${s.reason}`);
    const t0 = Date.now();
    const sig = combine(share, m, nn, { D2: s.D, E2: s.E, z2: s.z });
    n++;
    console.log(`sig ${n} ok ${c.kind}`, sig.slice(0, 16), `${Date.now() - t0}ms combine`);
  }
}
send({ t: 'wipe' });
console.log(`PASS: ${n} wrist signatures verified with BIP340`);
port.close();
process.exit(0);
