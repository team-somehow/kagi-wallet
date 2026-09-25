// End-to-end self-test over the internet relay, with the wrist on the auto-approve test
// firmware. Connects as the phone through the public tunnel, pairs, generates a key,
// then signs a grant, an over-cap transfer and a Sepolia smart-account call. Every
// signature is checked with a BIP340 verifier; the Sepolia one is also run through the
// real account code on Sepolia (eth_call with a state override, so it costs nothing).
// Run: npx tsx selftest-relay.ts   (hub running with --tunnel)
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPublicClient, encodeFunctionData, http, parseEther, toHex } from 'viem';
import { sepolia } from 'viem/chains';
import WebSocket from 'ws';
import {
  combine,
  dkgFinish,
  dkgStart,
  evmMessage,
  grantCanonical,
  messageFor,
  nonces,
  pairingCode,
  txCanonical,
} from '../mobile/src/lib/frost';

const pub = JSON.parse(readFileSync(new URL('./.public.json', import.meta.url), 'utf8'));
const art = JSON.parse(readFileSync(new URL('./LeashAccount.json', import.meta.url), 'utf8'));
const rand = (n: number) => new Uint8Array(randomBytes(n));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

const ws = new WebSocket(pub.phoneUrl);
const waiters: { pred: (m: any) => boolean; res: (m: any) => void }[] = [];
let wristVia = '';
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t === 'hub') wristVia = m.via;
  const i = waiters.findIndex((w) => w.pred(m));
  if (i >= 0) waiters.splice(i, 1)[0].res(m);
});
const send = (o: object) => ws.send(JSON.stringify(o));
const expect = (pred: (m: any) => boolean, what: string, ms = 20000) =>
  new Promise<any>((res, rej) => {
    waiters.push({ pred, res });
    setTimeout(() => rej(new Error(`timed out waiting for ${what}`)), ms);
  });
await new Promise((r) => ws.once('open', r));
const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;

send({ t: 'hello?' });
const hello = await expect((m) => m.t === 'hello', 'hello');
console.log(`phone reached wrist ${hello.id} via ${hello.via} through ${new URL(pub.hub).host}  ${ms()}`);
if (hello.via !== 'relay') throw new Error(`wrist is on ${hello.via}, not the relay`);

// Wipe and pair from scratch, the way the app does it.
send({ t: 'wipe' });
await expect((m) => m.t === 'hello' && m.paired === false, 'wipe');
const phoneNonce = hex(rand(16));
const pairP = expect((m) => m.t === 'pair', 'pair');
const okP = expect((m) => m.t === 'pair_ok', 'pair_ok');
send({ t: 'pair', nonce: phoneNonce });
const pair = await pairP;
await okP;
console.log(`paired, code ${pairingCode(phoneNonce, pair.nonce)}  ${ms()}`);

const mine = dkgStart(rand);
const dkgP = expect((m) => m.t === 'dkg' || m.t === 'dkg_error', 'dkg');
send({ t: 'dkg', X: mine.X, pop: mine.pop });
const dkg = await dkgP;
if (dkg.t !== 'dkg') throw new Error(`dkg failed: ${dkg.reason}`);
const share = dkgFinish(mine, dkg.X, dkg.pop);
if (share.groupKey !== dkg.groupKey) throw new Error('group keys differ');
console.log(`group key ${share.groupKey}  ${ms()}`);

async function sign(label: string, fields: Record<string, unknown>, m: Uint8Array) {
  const n = nonces(rand);
  const id = `st${Math.random().toString(36).slice(2, 8)}`;
  const p = expect((x) => (x.t === 'sig_share' || x.t === 'sign_reject') && x.id === id, label, 30000);
  send({ t: 'sign', id, ...fields, D: n.D, E: n.E });
  const r = await p;
  if (r.t === 'sign_reject') throw new Error(`${label}: wrist rejected, ${r.reason}`);
  const sig = combine(share, m, n, { D2: r.D, E2: r.E, z2: r.z });
  console.log(`PASS ${label}: BIP340 signature ${sig.slice(0, 16)}…  ${ms()}`);
  return sig;
}

const agentKey = `0x02${hex(rand(32))}`;
await sign(
  'grant',
  { kind: 'grant', agent: 'trader', pubkey: agentKey, capMicro: '500000000', hours: 24 },
  messageFor(grantCanonical('trader', agentKey, 500, 24)),
);

const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const calldata = `0xa9059cbb${'1f9840a85d5af5bf1d1762f925bdaddc4201f984'.padStart(64, '0')}${(600_000_000).toString(16).padStart(64, '0')}`;
await sign('over-cap transfer', { kind: 'tx', agent: 'trader', to: usdc, calldata }, messageFor(txCanonical(usdc, calldata)));

// Sepolia: the wrist builds the contract's preimage in C; the contract must accept it.
const account = '0x1ea5000000000000000000000000000000001ea5';
const to = '0x000000000000000000000000000000000000dEaD';
const value = parseEther('0.000001');
const call = { chainId: sepolia.id, account, nonce: 0n, to, value, data: '0x' };
const sig = await sign(
  'Sepolia smart-account call',
  { kind: 'evm', agent: 'you', chainId: String(sepolia.id), account, nonce: '0', to, value: value.toString(), data: '0x' },
  evmMessage(call),
);
const client = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
const px = BigInt(`0x${share.groupKey}`);
const exec = encodeFunctionData({ abi: art.abi, functionName: 'execute', args: [to, value, '0x', BigInt(`0x${sig.slice(0, 64)}`), BigInt(`0x${sig.slice(64)}`)] });
const override = [
  {
    address: account,
    code: art.deployed,
    balance: parseEther('1'),
    stateDiff: [
      { slot: toHex(0, { size: 32 }), value: toHex(0, { size: 32 }) },
      { slot: toHex(1, { size: 32 }), value: toHex(px, { size: 32 }) },
    ],
  },
];
await client.call({ to: account, data: exec, stateOverride: override } as never);
console.log(`PASS Sepolia account code accepted the wrist-signed call  ${ms()}`);

// Session-key grant: the wrist builds the grant preimage in C; the v2 contract must accept it.
{
  const { evmGrantMessage, phoneKey } = await import('../mobile/src/lib/frost');
  const agentAddr = '0x1111111111111111111111111111111111111111';
  const cap = 5_000_000_000_000n;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const gsig = await sign(
    'Sepolia session-key grant',
    { kind: 'evm_grant', agent: 'trader', chainId: String(sepolia.id), account, nonce: '0', agentAddress: agentAddr, cap: cap.toString(), expiry: expiry.toString() },
    evmGrantMessage({ chainId: sepolia.id, account, nonce: 0n, agent: agentAddr, cap, expiry }),
  );
  const g = encodeFunctionData({ abi: art.abi, functionName: 'grant', args: [agentAddr, cap, expiry, BigInt(`0x${gsig.slice(0, 64)}`), BigInt(`0x${gsig.slice(64)}`)] });
  const ov2 = [{ ...override[0], stateDiff: [...override[0].stateDiff, { slot: toHex(2, { size: 32 }), value: toHex(BigInt(`0x${phoneKey(share)}`), { size: 32 }) }] }];
  await client.call({ to: account, data: g, stateOverride: ov2 } as never);
  console.log(`PASS Sepolia account code accepted the wrist-signed grant  ${ms()}`);
}

console.log(`\nALL PASS over the relay (wrist via ${wristVia || hello.via}). Wallet left paired with test key.`);
ws.close();
process.exit(0);
