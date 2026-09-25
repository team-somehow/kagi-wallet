// Sepolia side of the hub. The relayer (hub/.relayer, gitignored) pays gas. It can only
// deploy accounts and submit calls that phone and wrist already signed; the account
// contract checks the threshold signature, so the relayer cannot move funds itself.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

const url = (f) => new URL(f, import.meta.url);
const RPC = process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const art = JSON.parse(readFileSync(url('./LeashAccount.json'), 'utf8'));
const STATE = url('./.evm.json');
const relayer = existsSync(url('./.relayer')) ? privateKeyToAccount(readFileSync(url('./.relayer'), 'utf8').trim()) : null;
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = relayer ? createWalletClient({ account: relayer, chain: sepolia, transport: http(RPC) }) : null;

const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
export const EXPLORER = 'https://sepolia.etherscan.io';

// Frugal fees: just above the current base fee, a tiny tip.
async function fees() {
  const b = await pub.getBlock();
  const tip = 1_000_000n; // 0.001 gwei
  return { maxPriorityFeePerGas: tip, maxFeePerGas: (b.baseFeePerGas * 125n) / 100n + tip };
}

export async function info(groupKey) {
  const st = load();
  const account = st[groupKey]?.account ?? null;
  const [relayerBalance, accountBalance, nonce, block] = await Promise.all([
    relayer ? pub.getBalance({ address: relayer.address }) : 0n,
    account ? pub.getBalance({ address: account }) : 0n,
    account ? pub.readContract({ address: account, abi: art.abi, functionName: 'nonce' }) : 0n,
    pub.getBlock(),
  ]);
  const f = block.baseFeePerGas + 1_000_000n;
  return {
    t: 'evm_info',
    chainId: sepolia.id,
    relayer: relayer?.address ?? null,
    relayerBalance: relayerBalance.toString(),
    account,
    accountBalance: accountBalance.toString(),
    nonce: nonce.toString(),
    deployCost: (222_400n * f).toString(),
    callCost: (70_000n * f).toString(),
    explorer: EXPLORER,
  };
}

export async function deploy(groupKey, fundWei) {
  if (!wallet) throw new Error('No relayer key in hub/.relayer.');
  const hash = await wallet.deployContract({
    abi: art.abi,
    bytecode: `${art.bytecode}${groupKey.padStart(64, '0')}`,
    value: BigInt(fundWei ?? 0),
    gas: 240_000n,
    ...(await fees()),
  });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy failed in ${hash}`);
  const st = load();
  st[groupKey] = { account: r.contractAddress, deployTx: hash };
  save(st);
  return { t: 'evm_deployed', account: r.contractAddress, hash, gasUsed: r.gasUsed.toString() };
}

export async function submit(groupKey, call) {
  if (!wallet) throw new Error('No relayer key in hub/.relayer.');
  const account = load()[groupKey]?.account;
  if (!account) throw new Error('No Leash account deployed for this wallet.');
  const args = [call.to, BigInt(call.value), call.data || '0x', BigInt(`0x${call.sig.slice(0, 64)}`), BigInt(`0x${call.sig.slice(64)}`)];
  // Simulate first so a bad signature costs nothing.
  await pub.simulateContract({ account: relayer, address: account, abi: art.abi, functionName: 'execute', args });
  const hash = await wallet.writeContract({ address: account, abi: art.abi, functionName: 'execute', args, gas: 90_000n, ...(await fees()) });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  return { t: 'evm_result', hash, status: r.status, gasUsed: r.gasUsed.toString(), block: r.blockNumber.toString() };
}

export const fmt = (wei) => `${formatEther(BigInt(wei))} ETH`;
