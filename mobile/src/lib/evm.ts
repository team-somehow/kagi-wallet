/**
 * The phone talks to Sepolia itself. No hub, no relayer.
 *
 * Gas comes from the phone's own gas wallet: an ordinary Sepolia key in the secure store.
 * It pays for deploying, granting, revoking and deciding limit requests. It holds no power
 * over the Kagi account: the contract checks the manager or phone signature on everything.
 * An agent pays its own gas; the phone tops its key up when it grants it.
 */
import * as SecureStore from 'expo-secure-store';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { KagiAccountAbi, KagiAccountBytecode, RootTreasuryAbi, RootTreasuryBytecode } from './contracts';
import { rand } from './shard';

export const CHAIN_ID = sepolia.id;
export const EXPLORER = 'https://sepolia.etherscan.io';
const RPC = process.env.EXPO_PUBLIC_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
// 5: the account has requestLimit and declineLimit. Wallets recorded under older versions redeploy.
const VERSION = 5;

export const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
type Addr = `0x${string}`;

// ---- the gas wallet -------------------------------------------------------------------

const GAS_KEY = 'kagi.gas.v1';
let gasCache: ReturnType<typeof privateKeyToAccount> | null = null;

export async function gasWallet() {
  if (gasCache) return gasCache;
  let priv = await SecureStore.getItemAsync(GAS_KEY);
  if (!priv) {
    let k: Uint8Array;
    do k = rand(32);
    while (!secp256k1.utils.isValidSecretKey(k));
    priv = `0x${bytesToHex(k)}`;
    await SecureStore.setItemAsync(GAS_KEY, priv);
  }
  gasCache = privateKeyToAccount(priv as Hex);
  return gasCache;
}

async function walletClient() {
  return createWalletClient({ account: await gasWallet(), chain: sepolia, transport: http(RPC) });
}

// Frugal fees: just above the current base fee, a tiny tip.
async function fees() {
  const b = await pub.getBlock();
  const tip = 1_000_000n;
  return { maxPriorityFeePerGas: tip, maxFeePerGas: ((b.baseFeePerGas ?? 1_000_000_000n) * 125n) / 100n + tip };
}

export function reason(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r?.reason) return r.reason;
    if (/insufficient funds/i.test(e.message)) return 'The phone gas wallet is out of Sepolia ETH. Top it up from Home.';
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

export interface Sent {
  hash: Hex;
  status: 'success' | 'reverted';
}

/** Simulate, send from the gas wallet, and wait for the receipt. onHash fires once it is sent. */
async function call(address: Addr, abi: Abi, functionName: string, args: readonly unknown[], onHash?: (h: Hex) => void): Promise<Sent> {
  const w = await walletClient();
  try {
    await pub.simulateContract({ account: w.account, address, abi, functionName, args });
  } catch (e) {
    throw new Error(`The account refused it: ${reason(e)}`);
  }
  const hash = await w.writeContract({ address, abi, functionName, args, chain: sepolia, ...(await fees()) });
  onHash?.(hash);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  return { hash, status: r.status };
}

// ---- which account belongs to which key -------------------------------------------------

const acctKey = (gk: string) => `kagi.account.${gk.slice(0, 32)}`;
const rootKeyName = (rk: string) => `kagi.root.${rk.slice(0, 32)}`;

export async function accountOf(gk: string): Promise<Addr | null> {
  try {
    const v = JSON.parse((await SecureStore.getItemAsync(acctKey(gk))) ?? 'null');
    return v?.version === VERSION ? (v.account as Addr) : null;
  } catch {
    return null;
  }
}

// ---- reads ------------------------------------------------------------------------------

export interface SessionState {
  cap: bigint;
  spent: bigint;
  expiry: bigint;
  nonce: bigint;
}

export async function session(account: Addr, agent: Addr): Promise<SessionState> {
  const [cap, spent, expiry, nonce] = (await pub.readContract({ address: account, abi: KagiAccountAbi, functionName: 'session', args: [agent] })) as readonly [bigint, bigint, bigint, bigint];
  return { cap, spent, expiry, nonce };
}

export async function overview(gk: string) {
  const [account, gas, block] = await Promise.all([accountOf(gk), gasWallet(), pub.getBlock()]);
  const [balance, nonce, gasBalance] = await Promise.all([
    account ? pub.getBalance({ address: account }) : 0n,
    account ? (pub.readContract({ address: account, abi: KagiAccountAbi, functionName: 'nonce' }) as Promise<bigint>) : 0n,
    pub.getBalance({ address: gas.address }),
  ]);
  return { chainId: CHAIN_ID, now: block.timestamp, block: block.number, account, balance, nonce, gasAddress: gas.address, gasBalance, explorer: EXPLORER };
}

// ---- writes -----------------------------------------------------------------------------

/** Deploy the Kagi account for this group key, funded from the gas wallet. */
export async function deploy(gk: string, phoneKey: string, fund: bigint): Promise<{ account: Addr; hash: Hex }> {
  const w = await walletClient();
  const data = `${KagiAccountBytecode}${gk.padStart(64, '0')}${phoneKey.replace(/^0x/, '').padStart(64, '0')}` as Hex;
  let gas: bigint;
  try {
    gas = await pub.estimateGas({ account: w.account, data, value: fund });
  } catch (e) {
    throw new Error(reason(e));
  }
  const hash = await w.sendTransaction({ data, value: fund, gas: (gas * 120n) / 100n, chain: sepolia, ...(await fees()) });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`The deploy failed in ${hash}.`);
  await SecureStore.setItemAsync(acctKey(gk), JSON.stringify({ version: VERSION, account: r.contractAddress, deployTx: hash }));
  return { account: r.contractAddress, hash };
}

const split = (sig: string) => [BigInt(`0x${sig.slice(0, 64)}`), BigInt(`0x${sig.slice(64, 128)}`)] as const;

export async function grant(account: Addr, m: { agent: Addr; cap: bigint; expiry: bigint; sig: string }, onHash?: (h: Hex) => void) {
  return call(account, KagiAccountAbi as Abi, 'grant', [m.agent, m.cap, m.expiry, ...split(m.sig)], onHash);
}

/** Plain ETH from the gas wallet, e.g. gas money for an agent's own key. */
export async function sendGas(to: Addr, value: bigint): Promise<Sent> {
  const w = await walletClient();
  const hash = await w.sendTransaction({ to, value, chain: sepolia, ...(await fees()) });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  return { hash, status: r.status };
}

export async function revoke(account: Addr, agent: Addr, sig: string) {
  return call(account, KagiAccountAbi as Abi, 'revoke', [agent, ...split(sig)]);
}

export async function raiseLimit(account: Addr, m: { agent: Addr; oldCap: bigint; newCap: bigint; expiry: bigint; sig: string }) {
  return call(account, KagiAccountAbi as Abi, 'raiseLimit', [m.agent, m.oldCap, m.newCap, m.expiry, ...split(m.sig)]);
}

export async function declineLimit(account: Addr, agent: Addr, newCap: bigint, sig: string) {
  return call(account, KagiAccountAbi as Abi, 'declineLimit', [agent, newCap, ...split(sig)]);
}

export async function execute(account: Addr, m: { to: Addr; value: bigint; data?: Hex; sig: string }) {
  return call(account, KagiAccountAbi as Abi, 'execute', [m.to, m.value, m.data ?? '0x', ...split(m.sig)]);
}

// ---- events: what agents did, and what they ask for -------------------------------------

export type AccountEvent =
  | { kind: 'spent'; agent: Addr; to: Addr; value: bigint; hash: Hex; block: bigint }
  | { kind: 'requested'; agent: Addr; oldCap: bigint; newCap: bigint; reason: string; hash: Hex; block: bigint }
  | { kind: 'raised'; agent: Addr; oldCap: bigint; newCap: bigint; hash: Hex; block: bigint }
  | { kind: 'declined'; agent: Addr; newCap: bigint; hash: Hex; block: bigint }
  | { kind: 'granted'; agent: Addr; cap: bigint; expiry: bigint; hash: Hex; block: bigint }
  | { kind: 'revoked'; agent: Addr; hash: Hex; block: bigint };

const EVENTS = (KagiAccountAbi as Abi).filter(
  (x) => x.type === 'event' && ['Spent', 'LimitRequested', 'LimitRaised', 'LimitDeclined', 'Granted', 'Revoked'].includes(x.name),
);

/** The account's events in [fromBlock, toBlock], oldest first. */
export async function events(account: Addr, fromBlock: bigint, toBlock: bigint): Promise<AccountEvent[]> {
  const logs = (await pub.getLogs({ address: account, events: EVENTS as any, fromBlock, toBlock })) as any[];
  const out: AccountEvent[] = [];
  for (const l of logs) {
    const a = l.args ?? {};
    const base = { hash: l.transactionHash as Hex, block: l.blockNumber as bigint, agent: a.agent as Addr };
    if (l.eventName === 'Spent') out.push({ ...base, kind: 'spent', to: a.to, value: a.value });
    else if (l.eventName === 'LimitRequested') out.push({ ...base, kind: 'requested', oldCap: a.oldCap, newCap: a.newCap, reason: a.reason });
    else if (l.eventName === 'LimitRaised') out.push({ ...base, kind: 'raised', oldCap: a.oldCap, newCap: a.newCap });
    else if (l.eventName === 'LimitDeclined') out.push({ ...base, kind: 'declined', newCap: a.newCap });
    else if (l.eventName === 'Granted') out.push({ ...base, kind: 'granted', cap: a.cap, expiry: a.expiry });
    else if (l.eventName === 'Revoked') out.push({ ...base, kind: 'revoked' });
  }
  return out;
}

// ---- the root treasury: owned by the 3-of-3 root key --------------------------------------

export async function rootAccountOf(rk: string): Promise<Addr | null> {
  try {
    return (JSON.parse((await SecureStore.getItemAsync(rootKeyName(rk))) ?? 'null')?.account as Addr) ?? null;
  } catch {
    return null;
  }
}

export async function rootInfo(rk: string) {
  const [account, gas] = await Promise.all([rootAccountOf(rk), gasWallet()]);
  const [balance, nonce, gasBalance] = await Promise.all([
    account ? pub.getBalance({ address: account }) : 0n,
    account ? (pub.readContract({ address: account, abi: RootTreasuryAbi, functionName: 'nonce' }) as Promise<bigint>) : 0n,
    pub.getBalance({ address: gas.address }),
  ]);
  return { chainId: CHAIN_ID, account, balance, nonce, gasAddress: gas.address, gasBalance, explorer: EXPLORER };
}

export async function rootDeploy(rk: string, fund: bigint): Promise<{ account: Addr; hash: Hex }> {
  const w = await walletClient();
  const data = `${RootTreasuryBytecode}${rk.padStart(64, '0')}` as Hex;
  const gas = await pub.estimateGas({ account: w.account, data, value: fund });
  const hash = await w.sendTransaction({ data, value: fund, gas: (gas * 120n) / 100n, chain: sepolia, ...(await fees()) });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`The deploy failed in ${hash}.`);
  await SecureStore.setItemAsync(rootKeyName(rk), JSON.stringify({ account: r.contractAddress, deployTx: hash }));
  return { account: r.contractAddress, hash };
}

export async function rootSubmit(rk: string, m: { to: Addr; value: bigint; sig: string }) {
  const account = await rootAccountOf(rk);
  if (!account) throw new Error('No root treasury deployed for this root key.');
  return call(account, RootTreasuryAbi as Abi, 'execute', [m.to, m.value, '0x', ...split(m.sig)]);
}
