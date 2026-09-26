// Sweep the gas sponsor wallet (EXPO_PUBLIC_GAS_SPONSOR_KEY in mobile/.env.local) back to the
// owner. Its key ships inside the APK, so anything that lands there can be taken by anyone:
// run this after demos to move it all home.
//
//   npx tsx scripts/sweep-sponsor.mts                 dry run on Ethereum mainnet
//   npx tsx scripts/sweep-sponsor.mts --send          send it
//   npx tsx scripts/sweep-sponsor.mts --network sepolia [--send]
//   npx tsx scripts/sweep-sponsor.mts --to 0x...      a different destination
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, formatEther, getAddress, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

const OWNER = '0x7aa25897BB2457F46109EF1886b3F0EBB6E5f67E';
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const send = process.argv.includes('--send');
const net = arg('--network') === 'sepolia' ? sepolia : mainnet;
const rpc = net.id === 1 ? 'https://ethereum-rpc.publicnode.com' : 'https://ethereum-sepolia-rpc.publicnode.com';
const to = getAddress(arg('--to') ?? OWNER);

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
const key = /^EXPO_PUBLIC_GAS_SPONSOR_KEY=(0x[0-9a-fA-F]{64})\s*$/m.exec(env)?.[1] as Hex | undefined;
if (!key) throw new Error('No EXPO_PUBLIC_GAS_SPONSOR_KEY in mobile/.env.local');
if (!isAddress(to)) throw new Error(`Bad destination ${to}`);

const from = privateKeyToAccount(key);
const pub = createPublicClient({ chain: net, transport: http(rpc) });
const wallet = createWalletClient({ account: from, chain: net, transport: http(rpc) });

const balance = await pub.getBalance({ address: from.address });
const { maxFeePerGas, maxPriorityFeePerGas } = await pub.estimateFeesPerGas();
const gas = 21_000n;
const fee = gas * maxFeePerGas;
console.log(`${net.name}: ${from.address} holds ${formatEther(balance)} ETH`);
if (balance <= fee) {
  console.log(`Nothing to sweep: the balance does not cover the ${formatEther(fee)} ETH transfer fee.`);
  process.exit(0);
}
// Everything but the worst-case fee; any fee not used stays behind as dust.
const value = balance - fee;
console.log(`Sweep ${formatEther(value)} ETH to ${to} (fee at most ${formatEther(fee)} ETH)`);
if (!send) {
  console.log('Dry run. Add --send to send it.');
  process.exit(0);
}
const hash = await wallet.sendTransaction({ to, value, gas, maxFeePerGas, maxPriorityFeePerGas });
console.log(`Sent ${hash}`);
const r = await pub.waitForTransactionReceipt({ hash });
console.log(`${r.status} in block ${r.blockNumber}: ${net.id === 1 ? 'https://etherscan.io' : 'https://sepolia.etherscan.io'}/tx/${hash}`);
