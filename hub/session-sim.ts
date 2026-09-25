// Free check of the v2 account on real Sepolia: every rule, run through eth_call with the
// storage each step would have left behind. Signatures come from the real protocol code.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPublicClient, encodeAbiParameters, encodeFunctionData, encodePacked, hexToBytes, http, keccak256, parseEther, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount, sign } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { combine, dkgFinish, dkgStart, evm1271Message, evmGrantMessage, evmMessage, evmRevokeMessage, nonces, phoneKey, phoneOnlySign, reference } from '../mobile/src/lib/frost';

const art = JSON.parse(readFileSync(new URL('./LeashAccount.json', import.meta.url), 'utf8'));
const client = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
const rand = (n: number) => new Uint8Array(randomBytes(n));
const phone = dkgStart(rand);
const wrist = reference.dkg(rand, phone.X, phone.pop);
const share = dkgFinish(phone, wrist.reply.X, wrist.reply.pop);
const account = '0x1ea5000000000000000000000000000000001ea5' as const;
const chainId = sepolia.id;
const managerSign = (m: Uint8Array) => {
  const n = nonces(rand);
  const w = reference.sign(rand, wrist.x, wrist.groupKey, m, n.D, n.E);
  const sig = combine(share, m, n, w);
  return [BigInt(`0x${sig.slice(0, 64)}`), BigInt(`0x${sig.slice(64)}`)] as const;
};
const slot = (agent: string) => BigInt(keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [agent as `0x${string}`, 3n])));
const hex32 = (v: bigint) => toHex(v, { size: 32 });
function state(nonce: bigint, sess?: { agent: string; cap: bigint; spent: bigint; expiry: bigint; sn: bigint }) {
  const diff = [
    { slot: hex32(0n), value: hex32(nonce) },
    { slot: hex32(1n), value: hex32(BigInt(`0x${share.groupKey}`)) },
    { slot: hex32(2n), value: hex32(BigInt(`0x${phoneKey(share)}`)) },
  ];
  if (sess) {
    const b = slot(sess.agent);
    diff.push({ slot: hex32(b), value: hex32(sess.cap) }, { slot: hex32(b + 1n), value: hex32(sess.spent) }, { slot: hex32(b + 2n), value: hex32(sess.expiry) }, { slot: hex32(b + 3n), value: hex32(sess.sn) });
  }
  return [{ address: account, code: art.deployed, balance: parseEther('1'), stateDiff: diff }];
}
let fails = 0;
async function check(label: string, data: `0x${string}`, ov: ReturnType<typeof state>, expectOk: boolean) {
  try {
    await client.call({ to: account, data, stateOverride: ov } as never);
    const gas = await client.estimateGas({ to: account, data, stateOverride: ov } as never).catch(() => 0n);
    if (!expectOk) fails++;
    console.log(`${expectOk ? 'PASS' : 'FAIL'} ${label}: accepted (${gas} gas)`);
  } catch (e) {
    const why = String((e as { shortMessage?: string }).shortMessage ?? e).split('\n')[0].replace('Execution reverted with reason: ', '');
    if (expectOk) fails++;
    console.log(`${expectOk ? 'FAIL' : 'PASS'} ${label}: rejected (${why.slice(0, 60)})`);
  }
}

const agentKey = generatePrivateKey();
const agent = privateKeyToAccount(agentKey).address;
const other = privateKeyToAccount(generatePrivateKey());
const cap = parseEther('0.00001');
const now = (await client.getBlock()).timestamp;
const expiry = now + 3600n;
const to = '0x000000000000000000000000000000000000dEaD' as const;

// grant
const [grx, gs] = managerSign(evmGrantMessage({ chainId, account, nonce: 0n, agent, cap, expiry }));
const grant = encodeFunctionData({ abi: art.abi, functionName: 'grant', args: [agent, cap, expiry, grx, gs] });
await check('grant signed by phone + wrist', grant, state(0n), true);
await check('grant replayed after nonce moved', grant, state(1n), false);
const [prx, ps] = [BigInt(`0x${phoneOnlySign(share, evmGrantMessage({ chainId, account, nonce: 0n, agent, cap, expiry }), rand).slice(0, 64)}`), 0n];
void prx; void ps;
const phoneGrant = phoneOnlySign(share, evmGrantMessage({ chainId, account, nonce: 0n, agent, cap, expiry }), rand);
await check('grant signed by the phone alone', encodeFunctionData({ abi: art.abi, functionName: 'grant', args: [agent, cap, expiry, BigInt(`0x${phoneGrant.slice(0, 64)}`), BigInt(`0x${phoneGrant.slice(64)}`)] }), state(0n), false);

// spends by the agent's own key, no human
const live = { agent, cap, spent: 0n, expiry, sn: 0n };
async function spendData(signer: `0x${string}`, sn: bigint, value: bigint, target: `0x${string}` = to) {
  const h = keccak256(encodePacked(['string', 'uint256', 'address', 'address', 'uint256', 'address', 'uint256'], ['LEASH/spend', BigInt(chainId), account, agent, sn, target, value]));
  const sig = await sign({ hash: h, privateKey: signer });
  return encodeFunctionData({ abi: art.abi, functionName: 'spend', args: [agent, target, value, Number(sig.v), sig.r, sig.s] });
}
await check('agent spends under the cap, no human', await spendData(agentKey, 0n, parseEther('0.000004')), state(1n, live), true);
await check('agent spends the rest of the cap', await spendData(agentKey, 1n, parseEther('0.000006')), state(1n, { ...live, spent: parseEther('0.000004'), sn: 1n }), true);
await check('agent goes one wei over the cap', await spendData(agentKey, 1n, parseEther('0.000006') + 1n), state(1n, { ...live, spent: parseEther('0.000004'), sn: 1n }), false);
await check('same spend replayed', await spendData(agentKey, 0n, parseEther('0.000004')), state(1n, { ...live, spent: parseEther('0.000004'), sn: 1n }), false);
await check('spend signed by a different key', await spendData(other.address.length ? (generatePrivateKey()) : agentKey, 0n, 1n), state(1n, live), false);
await check('agent spends after expiry', await spendData(agentKey, 0n, 1n), state(1n, { ...live, expiry: now - 1n }), false);
await check('agent sends to the account itself', await spendData(agentKey, 0n, 1n, account), state(1n, live), false);

// revoke by the phone alone
const rsig = phoneOnlySign(share, evmRevokeMessage(chainId, account, 1n, agent), rand);
await check('revoke signed by the phone alone', encodeFunctionData({ abi: art.abi, functionName: 'revoke', args: [agent, BigInt(`0x${rsig.slice(0, 64)}`), BigInt(`0x${rsig.slice(64)}`)] }), state(1n, live), true);
await check('agent spends after revoke', await spendData(agentKey, 0n, 1n), state(2n, { ...live, expiry: 0n }), false);

// manager execute still works
const [erx, es] = managerSign(evmMessage({ chainId, account, nonce: 2n, to, value: 1n, data: '0x' }));
await check('manager execute', encodeFunctionData({ abi: art.abi, functionName: 'execute', args: [to, 1n, '0x', erx, es] }), state(2n), true);

// ERC-1271: yes for the manager key over the wrapped message, no for anything else
const MAGIC = '0x1626ba7e';
async function read(fn: string, args: unknown[], ov: ReturnType<typeof state>) {
  const r = await client.call({ to: account, data: encodeFunctionData({ abi: art.abi, functionName: fn, args }), stateOverride: ov } as never);
  return (r.data ?? '0x').slice(0, 10);
}
async function expect(label: string, got: Promise<string>, want: string) {
  const g = await got.catch((e) => `reverted: ${String(e.shortMessage ?? e).split('\n')[0]}`);
  const ok = g === want;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${g}`);
}
const orderHash = keccak256(toHex('some EIP-712 digest'));
const packSig = (rx: bigint, s: bigint) => `0x${rx.toString(16).padStart(64, '0')}${s.toString(16).padStart(64, '0')}` as `0x${string}`;
const [orx, os] = managerSign(evm1271Message(chainId, account, orderHash));
await expect('1271 manager signature', read('isValidSignature', [orderHash, packSig(orx, os)], state(2n)), MAGIC);
await expect('1271 same signature, other hash', read('isValidSignature', [keccak256(toHex('other')), packSig(orx, os)], state(2n)), '0xffffffff');
const [rawRx, rawS] = managerSign(hexToBytes(orderHash.slice(2)));
await expect('1271 unwrapped hash signed directly', read('isValidSignature', [orderHash, packSig(rawRx, rawS)], state(2n)), '0xffffffff');
const phone1271 = phoneOnlySign(share, evm1271Message(chainId, account, orderHash), rand);
await expect('1271 phone shard alone', read('isValidSignature', [orderHash, `0x${phone1271}`], state(2n)), '0xffffffff');
const agentSig = await sign({ hash: orderHash, privateKey: agentKey, to: 'hex' });
await expect('1271 agent ECDSA key', read('isValidSignature', [orderHash, agentSig], state(2n, live)), '0xffffffff');
await expect('1271 wrong length', read('isValidSignature', [orderHash, `${packSig(orx, os)}00`], state(2n)), '0xffffffff');

// receiver hooks and ERC-165
const z = '0x0000000000000000000000000000000000000000' as const;
await expect('onERC721Received', read('onERC721Received', [z, z, 1n, '0x'], state(2n)), '0x150b7a02');
await expect('onERC1155Received', read('onERC1155Received', [z, z, 1n, 1n, '0x'], state(2n)), '0xf23a6e61');
await expect('onERC1155BatchReceived', read('onERC1155BatchReceived', [z, z, [1n], [1n], '0x'], state(2n)), '0xbc197c81');
const supports = async (id: string) => {
  const r = await client.call({ to: account, data: encodeFunctionData({ abi: art.abi, functionName: 'supportsInterface', args: [id] }), stateOverride: state(2n) } as never);
  return BigInt(r.data ?? '0x0') === 1n ? 'true' : 'false';
};
for (const [id, want] of [['0x01ffc9a7', 'true'], ['0x150b7a02', 'true'], ['0x4e2312e0', 'true'], ['0x1626ba7e', 'true'], ['0xffffffff', 'false']]) {
  await expect(`supportsInterface(${id})`, supports(id), want);
}

const deployGas = await client.estimateGas({ account: '0xD130448ff0c82Cd4f8044E41ACE6cA5289A88107', data: `${art.bytecode}${share.groupKey}${phoneKey(share)}` as `0x${string}` }).catch((e) => `failed: ${e.shortMessage}`);
console.log(`\ndeploy estimate: ${deployGas} gas`);
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
