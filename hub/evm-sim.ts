// Free check of the Leash account against real Sepolia: runs the contract code through
// eth_call with a state override, using signatures from the real two-party protocol
// (both halves in JS here). Also estimates what deploying and executing would cost.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPublicClient, encodeFunctionData, formatEther, formatGwei, http, parseEther, toHex } from 'viem';
import { sepolia } from 'viem/chains';
import { combine, dkgFinish, dkgStart, evmMessage, nonces, reference } from '../mobile/src/lib/frost';

const art = JSON.parse(readFileSync(new URL('./LeashAccount.json', import.meta.url), 'utf8'));
const client = createPublicClient({ chain: sepolia, transport: http('https://ethereum-sepolia-rpc.publicnode.com') });
const rand = (n: number) => new Uint8Array(randomBytes(n));

const phone = dkgStart(rand);
const wrist = reference.dkg(rand, phone.X, phone.pop);
const share = dkgFinish(phone, wrist.reply.X, wrist.reply.pop);
const px = BigInt(`0x${share.groupKey}`);

const account = '0x1ea5000000000000000000000000000000001ea5' as const;
const to = '0x000000000000000000000000000000000000dEaD' as const;
const value = parseEther('0.000001');
const overrideFor = (nonce: bigint) => [
  {
    address: account,
    code: art.deployed as `0x${string}`,
    balance: parseEther('1'),
    stateDiff: [
      { slot: toHex(0, { size: 32 }), value: toHex(nonce, { size: 32 }) },
      { slot: toHex(1, { size: 32 }), value: toHex(px, { size: 32 }) },
    ],
  },
];

function sign(nonce: bigint, data = '0x') {
  const m = evmMessage({ chainId: sepolia.id, account, nonce, to, value, data });
  const mine = nonces(rand);
  const w = reference.sign(rand, wrist.x, wrist.groupKey, m, mine.D, mine.E);
  const sig = combine(share, m, mine, w);
  return { rx: BigInt(`0x${sig.slice(0, 64)}`), s: BigInt(`0x${sig.slice(64)}`) };
}

async function run(label: string, nonce: bigint, sig: { rx: bigint; s: bigint }, expectOk: boolean) {
  const data = encodeFunctionData({ abi: art.abi, functionName: 'execute', args: [to, value, '0x', sig.rx, sig.s] });
  try {
    await client.call({ to: account, data, stateOverride: overrideFor(nonce) });
    const gas = await client.estimateGas({ to: account, data, stateOverride: overrideFor(nonce) } as never).catch(() => null);
    console.log(`${expectOk ? 'PASS' : 'FAIL'} ${label}: accepted${gas ? `, ${gas} gas` : ''}`);
    return gas;
  } catch (e) {
    const why = (e as { shortMessage?: string }).shortMessage ?? String(e);
    console.log(`${expectOk ? 'FAIL' : 'PASS'} ${label}: rejected (${why.split('\n')[0].slice(0, 80)})`);
    return null;
  }
}

const good = sign(0n);
const gas = await run('valid signature', 0n, good, true);
await run('same signature replayed at nonce 1', 1n, good, false);
await run('tampered s', 0n, { ...good, s: good.s ^ 1n }, false);
for (let i = 1; i <= 5; i++) await run(`valid signature ${i + 1}`, 0n, sign(0n), true);

const block = await client.getBlock();
// Constructor takes (groupKey, phoneKey); the phone key doesn't matter for a gas estimate.
const deployData = `${art.bytecode}${px.toString(16).padStart(64, '0').repeat(2)}` as `0x${string}`;
const deployGas = await client.estimateGas({ data: deployData, account: '0xD130448ff0c82Cd4f8044E41ACE6cA5289A88107', value: parseEther('0') }).catch((e) => {
  console.log('deploy estimate failed:', e.shortMessage);
  return null;
});
const fee = block.baseFeePerGas! + 10_000_000n;
console.log(`base fee ${formatGwei(block.baseFeePerGas!)} gwei`);
if (deployGas) console.log(`deploy ${deployGas} gas, about ${formatEther(deployGas * fee)} ETH now`);
if (gas) console.log(`execute ${gas} gas, about ${formatEther(gas * fee)} ETH now`);
