// Root key, end to end on the real sticks: 2-of-2 key generation with the wrist, reshare
// to 3-of-3 with the vault (pieces sealed to the vault's device key), then a root signature
// that travels phone -> wrist -> IR -> vault -> IR -> wrist -> phone and is checked with BIP340.
// Needs the hub running and both sticks on test firmware (auto A). Run: npx tsx selftest-root.ts
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { dkgFinish, dkgStart } from '../mobile/src/lib/frost';
import {
  combineRoot, cpt, partial, phoneReshare, pt, reshareCheck, rootNonces, type Commit, type RootShare,
} from '../mobile/src/lib/root';

const rand = (n: number) => new Uint8Array(randomBytes(n));
const ws = new WebSocket('ws://localhost:8787');
const waiters: { pred: (m: any) => boolean; res: (m: any) => void }[] = [];
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  const i = waiters.findIndex((w) => w.pred(m));
  if (i >= 0) waiters.splice(i, 1)[0].res(m);
});
const send = (o: object) => ws.send(JSON.stringify(o));
const expect = (pred: (m: any) => boolean, what: string, ms = 30000) =>
  new Promise<any>((res, rej) => {
    waiters.push({ pred, res });
    setTimeout(() => rej(new Error(`timed out waiting for ${what}`)), ms);
  });
await new Promise((r) => ws.once('open', r));
const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const toPt = (h65: string) => cpt(pt(h65));

// 1. Root key, 2-of-2 with the wrist
const mine = dkgStart(rand);
const dk = expect((m) => (m.t === 'root_dkg' || (m.t === 'sign_reject' && m.id === 'root_dkg')) && !m.from, 'root_dkg', 30000);
send({ t: 'root_dkg', X: mine.X, pop: mine.pop });
const d = await dk;
if (d.t !== 'root_dkg') throw new Error(`wrist refused root key: ${d.reason}`);
const s2 = dkgFinish(mine, d.X, d.pop);
if (s2.groupKey !== d.groupKey) throw new Error('root group keys differ');
let root: RootShare = { share: s2.share, groupKey: s2.groupKey, parties: 2, pub: { '1': toPt(s2.X1), '2': toPt(s2.X2) } };
console.log(`PASS root key 2-of-2 with the wrist: ${root.groupKey.slice(0, 16)}…  ${ms()}`);

// 2. Vault: device key and the reshare window
const vh = expect((m) => m.t === 'hello' && m.from === 'vault', 'vault hello', 10000);
send({ t: 'hello?', to: 'vault' });
const vault = await vh;
console.log(`vault ${vault.id}, device key fingerprint ${vault.fingerprint}`);
send({ t: 'open_window', to: 'vault' });
await new Promise((r) => setTimeout(r, 1500));

// 3. Reshare
const ph = phoneReshare(root, vault.devPub, rand);
const wristPart = expect((m) => (m.t === 'root_reshare' || (m.t === 'sign_reject' && m.id === 'root_reshare')) && !m.from, 'wrist reshare', 30000);
const vaultDone = expect((m) => m.from === 'vault' && (m.t === 'reshare_vault' || m.t === 'reshare_error'), 'vault reshare', 40000);
send({ t: 'reshare_piece', to: 'vault', from: 'phone', ct: ph.sealed, groupKey: root.groupKey });
send({ t: 'root_reshare', vaultPub: vault.devPub });
const w = await wristPart;
if (w.t !== 'root_reshare') throw new Error(`wrist refused reshare: ${w.reason}`);
const v = await vaultDone;
if (v.t !== 'reshare_vault') throw new Error(`vault refused reshare: ${v.reason}`);
if (!reshareCheck(root.groupKey, ph.X1, w.X2, v.X3)) throw new Error('reshare would move the group key');
const committed = expect((m) => m.t === 'root_committed', 'commit');
send({ t: 'root_commit' });
if ((await committed).parties !== 3) throw new Error('wrist did not commit');
root = { share: ph.x1, groupKey: root.groupKey, parties: 3, pub: { '1': ph.X1, '2': w.X2, '3': v.X3 }, vaultPub: vault.devPub };
console.log(`PASS reshared to 3-of-3, same group key; phone never saw the vault's share  ${ms()}`);

// 4. A real Sepolia transaction from a treasury only the 3-of-3 root key controls.
const { createPublicClient, encodeFunctionData, getContractAddress, http, parseEther, toHex } = await import('viem');
const { sepolia } = await import('viem/chains');
const { privateKeyToAccount } = await import('viem/accounts');
const { readFileSync } = await import('node:fs');
const { evmMessage } = await import('../mobile/src/lib/frost');
const client = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
const relayer = privateKeyToAccount(readFileSync(new URL('./.relayer', import.meta.url), 'utf8').trim() as `0x${string}`);
const art = JSON.parse(readFileSync(new URL('./RootTreasury.json', import.meta.url), 'utf8'));
const account = getContractAddress({ from: relayer.address, nonce: BigInt(await client.getTransactionCount({ address: relayer.address, blockTag: 'pending' })) });
const to = '0x000000000000000000000000000000000000dEaD' as const;
const value = parseEther('0.000001');
const m = evmMessage({ chainId: sepolia.id, account, nonce: 0n, to, value, data: '0x' });
console.log(`treasury will be ${account}; sending ${value} wei to ${to}`);

const n1 = rootNonces(rand);
const id = `r${Date.now()}`;
const ans = expect((x) => (x.t === 'root_share' || x.t === 'sign_reject') && x.id === id, 'root share', 240000);
const prog = (step: string) => expect((x) => x.t === 'root_progress' && x.id === id && x.step === step, step, 240000).then(() => console.log(`  ${step}  ${ms()}`));
void prog('ir_to_vault');
void prog('vault_prompted');
send({ t: 'root_sign', kind: 'evm', id, chainId: String(sepolia.id), account, nonce: '0', to, value: value.toString(), D: n1.D, E: n1.E });
const r = await ans;
if (r.t === 'sign_reject') throw new Error(`root signing refused: ${r.reason}`);
const cs: Commit[] = [{ id: 1, D: n1.D, E: n1.E }, { id: 2, D: r.D2, E: r.E2 }, { id: 3, D: r.D3, E: r.E3 }];
const z1 = partial(root.share, root.groupKey, m, cs, 1, n1);
const sig = combineRoot(root, m, cs, { 1: z1, 2: r.z2, 3: r.z3 });
console.log(`PASS root signature, 3 of 3 (vault over IR), BIP340 valid: ${sig.slice(0, 16)}…  ${ms()}`);

// Free check against the real contract code before spending anything.
const data = encodeFunctionData({ abi: art.abi, functionName: 'execute', args: [to, value, '0x', BigInt(`0x${sig.slice(0, 64)}`), BigInt(`0x${sig.slice(64)}`)] });
await client.call({ to: account, data, stateOverride: [{ address: account, code: art.deployed, balance: parseEther('1'), stateDiff: [{ slot: toHex(1, { size: 32 }), value: toHex(BigInt(`0x${root.groupKey}`), { size: 32 }) }] }] } as never);
console.log(`PASS treasury code accepts the signature (simulated)  ${ms()}`);

const req = (o: object, ms2 = 200000) => {
  const reqId = Math.random().toString(36).slice(2);
  const p = expect((x) => x.reqId === reqId, String((o as { t: string }).t), ms2);
  send({ ...o, reqId });
  return p;
};
const dep = await req({ t: 'evm_root_deploy', groupKey: root.groupKey, fund: parseEther('0.00001').toString() });
if (dep.t === 'evm_error') throw new Error(dep.reason);
if (dep.account.toLowerCase() !== account.toLowerCase()) throw new Error(`deployed at ${dep.account}, signed for ${account}`);
console.log(`PASS treasury deployed: https://sepolia.etherscan.io/tx/${dep.hash}  ${ms()}`);
const sub = await req({ t: 'evm_root_submit', groupKey: root.groupKey, to, value: value.toString(), sig });
if (sub.t === 'evm_error') throw new Error(sub.reason);
console.log(`PASS 3-of-3 transaction ${sub.status} on Sepolia: https://sepolia.etherscan.io/tx/${sub.hash}  ${ms()}`);
ws.close();
process.exit(0);
