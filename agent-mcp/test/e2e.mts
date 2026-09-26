// End to end on anvil: phone-side message builders + contract + agent MCP server.
import { spawn } from 'node:child_process';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { createPublicClient, createWalletClient, http, parseEther, formatEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { evmDeclineMessage, evmGrantMessage, evmLimitMessage } from '../../mobile/src/lib/frost';
import { KagiAccountAbi, KagiAccountBytecode } from '../../mobile/src/lib/contracts';

const RPC = 'http://127.0.0.1:8545';
const pub = createPublicClient({ chain: foundry, transport: http(RPC) });
// anvil's first dev account plays the phone's gas wallet
const phone = createWalletClient({ account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'), chain: foundry, transport: http(RPC) });
const G = schnorr.utils.randomSecretKey(); // stands in for the phone + stick group secret
const P = schnorr.utils.randomSecretKey(); // the phone's own shard
const sig = (m: Uint8Array, k: Uint8Array) => {
  const s = bytesToHex(schnorr.sign(m, k));
  return [BigInt(`0x${s.slice(0, 64)}`), BigInt(`0x${s.slice(64)}`)] as const;
};
let fails = 0;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
  if (!ok) fails++;
};
const tx = async (h: Hex) => pub.waitForTransactionReceipt({ hash: h });

const data = `${KagiAccountBytecode}${bytesToHex(schnorr.getPublicKey(G)).padStart(64, '0')}${bytesToHex(schnorr.getPublicKey(P)).padStart(64, '0')}` as Hex;
const dep = await tx(await phone.sendTransaction({ data, value: parseEther('0.001') }));
const account = dep.contractAddress!;
check(Boolean(account), `deployed the Kagi account ${account}`);

const agentKey = bytesToHex(schnorr.utils.randomSecretKey());
const agent = privateKeyToAccount(`0x${agentKey}`).address;
const now = (await pub.getBlock()).timestamp;
const expiry = now + 3600n;
const cap = parseEther('0.000005');
const nonce0 = (await pub.readContract({ address: account, abi: KagiAccountAbi, functionName: 'nonce' })) as bigint;
const g = sig(evmGrantMessage({ chainId: foundry.id, account, nonce: nonce0, agent, cap, expiry }), G);
await tx(await phone.writeContract({ address: account, abi: KagiAccountAbi, functionName: 'grant', args: [agent, cap, expiry, ...g] }));
await tx(await phone.sendTransaction({ to: agent, value: parseEther('0.01') }));
check(true, 'granted a 0.000005 ETH key and sent it gas');

const ABC = '0xD130448ff0c82Cd4f8044E41ACE6cA5289A88107';
const srv = spawn('node', ['server.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, SESSION_KEY: `kagi:${account}:0x${agentKey}`, RPC_URL: RPC, MCP_TOKEN: 't', PORT: '8795', CONTACTS: JSON.stringify({ ABC }) },
  stdio: ['ignore', 'pipe', 'inherit'],
});
srv.stdout.on('data', (d) => process.stdout.write(`  [mcp] ${d}`));
await new Promise((r) => setTimeout(r, 1500));
const c = new Client({ name: 'e2e', version: '0' });
// The shared endpoint: the connector link carries the account and the key.
const link = `http://127.0.0.1:8795/k/${account.slice(2)}${agentKey}`;
await c.connect(new StreamableHTTPClientTransport(new URL(link)));
const own = new Client({ name: 'own', version: '0' });
await own.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8795/mcp/t')));
check((await own.listTools()).tools.some((t) => t.name === 'send_eth'), 'single-key endpoint still serves its tools');
const demo = new Client({ name: 'demo', version: '0' });
await demo.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8795/demo')));
const dw = (await demo.callTool({ name: 'get_wallet', arguments: {} })).structuredContent as Record<string, any>;
check(dw.ok === true && dw.allowance_left === '0.000005 ETH', `public demo spends from the demo key (${dw.allowance_left})`);
const bad = await fetch('http://127.0.0.1:8795/k/not-a-key', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
check(bad.status === 404, `a bad connector link gets ${bad.status}`);
const call = async (name: string, args: Record<string, unknown> = {}) => (await c.callTool({ name, arguments: args })).structuredContent as Record<string, any>;

// The phone: watch for limit requests and answer them.
async function phoneAnswers(approve: boolean) {
  for (let i = 0; i < 40; i++) {
    const logs = await pub.getContractEvents({ address: account, abi: KagiAccountAbi, eventName: 'LimitRequested', fromBlock: 0n });
    const handled = new Set([
      ...(await pub.getContractEvents({ address: account, abi: KagiAccountAbi, eventName: 'LimitRaised', fromBlock: 0n })).map((l: any) => String(l.args.newCap)),
      ...(await pub.getContractEvents({ address: account, abi: KagiAccountAbi, eventName: 'LimitDeclined', fromBlock: 0n })).map((l: any) => String(l.args.newCap)),
    ]);
    const open = (logs as any[]).find((l) => !handled.has(String(l.args.newCap)));
    if (open) {
      const n = (await pub.readContract({ address: account, abi: KagiAccountAbi, functionName: 'nonce' })) as bigint;
      const { oldCap, newCap } = open.args;
      if (approve) {
        const s = sig(evmLimitMessage({ chainId: foundry.id, account, nonce: n, agent, oldCap, newCap, expiry }), G);
        await tx(await phone.writeContract({ address: account, abi: KagiAccountAbi, functionName: 'raiseLimit', args: [agent, oldCap, newCap, expiry, ...s] }));
      } else {
        const s = sig(evmDeclineMessage(foundry.id, account, n, agent, newCap), P);
        await tx(await phone.writeContract({ address: account, abi: KagiAccountAbi, functionName: 'declineLimit', args: [agent, newCap, ...s] }));
      }
      return newCap as bigint;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('no request seen');
}

try {
  const w0 = await call('get_wallet');
  check(w0.ok && w0.allowance_left === '0.000005 ETH', `get_wallet: ${w0.allowance_left} left, gas ${w0.gas_left}`);
  const TO = '0x7aa25897BB2457F46109EF1886b3F0EBB6E5f67E';
  const s1 = await call('send_eth', { to: TO, amount_eth: '0.000002' });
  check(s1.status === 'confirmed' && (await pub.getBalance({ address: TO })) === parseEther('0.000002'), `first transfer, to a raw address: ${s1.status}`);
  const s2 = await call('send_eth', { to: 'ABC', amount_eth: '0.000008' });
  check(s2.status === 'waiting_for_owner' && s2.requested_total === '0.00002 ETH', `second transfer asks for ${s2.requested_total} (${s2.status})`);
  const answered = phoneAnswers(true);
  const w1 = await call('wait_for_approval', { request_id: s2.request_id });
  await answered;
  check(w1.status === 'approved' && w1.payment?.status === 'confirmed', `approved, payment ${w1.payment?.status}`);
  const w2 = await call('get_wallet');
  check(w2.allowance_left === '0.00001 ETH' && w2.allowance_total === '0.00002 ETH', `after: ${w2.allowance_left} left of ${w2.allowance_total}`);

  const s3 = await call('send_eth', { to: 'ABC', amount_eth: '0.00002' });
  check(s3.status === 'waiting_for_owner', `third transfer asks again (${s3.status})`);
  const declined = phoneAnswers(false);
  const w3 = await call('wait_for_approval', { request_id: s3.request_id });
  await declined;
  check(w3.status === 'rejected', `declined: ${w3.status}`);
  const w4 = await call('get_wallet');
  check(w4.allowance_total === '0.00002 ETH' && w4.spent === '0.00001 ETH', `decline kept the limit (${w4.allowance_total}) and sent nothing more (${w4.spent} spent)`);
  const bal = await pub.getBalance({ address: ABC });
  check(bal === parseEther('0.000008'), `ABC received ${formatEther(bal)} ETH`);
  const s4 = await call('send_eth', { to: 'Bob', amount_eth: '0.000001' });
  check(s4.status === 'unknown_recipient', `unknown contact: ${s4.status}`);

  // A server with no demo key: a connection starts empty, then use_my_key switches it to the user's key.
  const bare = spawn('node', ['server.mjs'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, SESSION_KEY: '', RPC_URL: RPC, PORT: '8797', CONTACTS: JSON.stringify({ ABC }) },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  try {
    await new Promise((r) => setTimeout(r, 1500));
    const u = new Client({ name: 'user', version: '0' });
    await u.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8797/demo')));
    const ucall = async (name: string, args: Record<string, unknown> = {}) => (await u.callTool({ name, arguments: args })).structuredContent as Record<string, any>;
    check((await u.listTools()).tools.some((t) => t.name === 'use_my_key'), 'the demo link offers use_my_key');
    const empty = await ucall('get_wallet');
    check(empty.status === 'not_configured', `before a key: ${empty.status}`);
    const badKey = await ucall('use_my_key', { session_key: 'not a key' });
    check(badKey.status === 'bad_key', `a bad key is refused: ${badKey.status}`);
    const on = await ucall('use_my_key', { session_key: `kagi:${account}:0x${agentKey}` });
    check(on.connected === true && on.allowance_total === '0.00002 ETH', `use_my_key connects this session (${on.allowance_left} left)`);
    const after = await ucall('get_wallet');
    check(after.ok === true && after.wallet?.toLowerCase() === account.toLowerCase(), 'later calls in the session use that key');
    const other = new Client({ name: 'other', version: '0' });
    await other.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:8797/demo')));
    const o = (await other.callTool({ name: 'get_wallet', arguments: {} })).structuredContent as Record<string, any>;
    check(o.status === 'not_configured', 'another connection does not see that key');
  } finally {
    bare.kill();
  }
} finally {
  srv.kill();
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
