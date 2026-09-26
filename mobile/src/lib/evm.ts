/**
 * The phone talks to the chain itself. No hub, no relayer.
 *
 * Gas comes from the gas wallet: the testnet key compiled into the build as
 * EXPO_PUBLIC_GAS_SPONSOR_KEY (mobile/.env.local), or, in a build without one, a key the phone
 * makes and keeps in its secure store. It pays for deploying, granting, revoking and deciding
 * limit requests. It holds no power
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
  keccak256,
  stringToHex,
  type Abi,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';
import { KagiAccountAbi, KagiAccountBytecode, RootTreasuryAbi, RootTreasuryBytecode } from './contracts';
import { rand } from './shard';

// 5: the account has requestLimit and declineLimit. Wallets recorded under older versions redeploy.
const VERSION = 5;
type Addr = `0x${string}`;

// ---- the network --------------------------------------------------------------------------
// Sepolia (testnet) or Ethereum mainnet, chosen in More and kept in the secure store. Switching
// is live: these bindings are reassigned, and everything reads them through evm.*. Each network
// has its own Kagi account for the same key shares, so switching starts the account flow again.

export type Network = 'testnet' | 'mainnet';
const NETWORK_KEY = 'kagi.network.v1';
const NETS = {
  testnet: { chain: sepolia, rpc: process.env.EXPO_PUBLIC_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com', explorer: 'https://sepolia.etherscan.io', label: 'Testnet (Sepolia)' },
  mainnet: { chain: mainnet, rpc: process.env.EXPO_PUBLIC_MAINNET_RPC ?? 'https://ethereum-rpc.publicnode.com', explorer: 'https://etherscan.io', label: 'Ethereum mainnet' },
} as const;

function savedNetwork(): Network {
  try {
    return SecureStore.getItem(NETWORK_KEY) === 'mainnet' ? 'mainnet' : 'testnet';
  } catch {
    return 'testnet';
  }
}

export let network: Network = savedNetwork();
export let CHAIN_ID: number = NETS[network].chain.id;
export let EXPLORER: string = NETS[network].explorer;
let CHAIN: typeof sepolia | typeof mainnet = NETS[network].chain;
let RPC: string = NETS[network].rpc;
export let pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
export const networkLabel = (n: Network = network) => NETS[n].label;

const networkListeners = new Set<(n: Network) => void>();
export function onNetworkChange(l: (n: Network) => void) {
  networkListeners.add(l);
  return () => void networkListeners.delete(l);
}

/** Switch the whole app to another network, now and on the next launch. */
export function switchNetwork(n: Network) {
  if (n === network) return;
  SecureStore.setItem(NETWORK_KEY, n);
  network = n;
  CHAIN = NETS[n].chain;
  CHAIN_ID = CHAIN.id;
  RPC = NETS[n].rpc;
  EXPLORER = NETS[n].explorer;
  pub = createPublicClient({ chain: CHAIN, transport: http(RPC) });
  gasCache = null;
  networkListeners.forEach((l) => l(n));
}

// ---- the gas wallet -------------------------------------------------------------------

const GAS_KEY = 'kagi.gas.v1';
// On mainnet the phone keeps its own gas key and the owner funds it: never the sponsor key.
const MAINNET_GAS_KEY = 'kagi.gas.mainnet.v1';
// Anyone with the APK can read a compiled-in key: testnet only, keep its balance small.
const BUILD_GAS_KEY = process.env.EXPO_PUBLIC_GAS_SPONSOR_KEY;
let gasCache: ReturnType<typeof privateKeyToAccount> | null = null;

/** Whether this network's gas wallet is the shared testnet sponsor (so it tops up by itself). */
export const sponsoredGas = () => network === 'testnet' && Boolean(BUILD_GAS_KEY && /^0x[0-9a-fA-F]{64}$/.test(BUILD_GAS_KEY));

export async function gasWallet() {
  if (gasCache) return gasCache;
  if (sponsoredGas()) {
    gasCache = privateKeyToAccount(BUILD_GAS_KEY as Hex);
    return gasCache;
  }
  const slot = network === 'mainnet' ? MAINNET_GAS_KEY : GAS_KEY;
  let priv = await SecureStore.getItemAsync(slot);
  if (!priv) {
    let k: Uint8Array;
    do k = rand(32);
    while (!secp256k1.utils.isValidSecretKey(k));
    priv = `0x${bytesToHex(k)}`;
    await SecureStore.setItemAsync(slot, priv);
  }
  gasCache = privateKeyToAccount(priv as Hex);
  return gasCache;
}

async function walletClient() {
  return createWalletClient({ account: await gasWallet(), chain: CHAIN, transport: http(RPC) });
}

// Frugal fees: just above the current base fee, a tiny tip.
async function fees() {
  const b = await pub.getBlock();
  // Mainnet needs a real tip to be picked up promptly; testnet takes almost nothing.
  const tip = network === 'mainnet' ? 100_000_000n : 1_000_000n;
  return { maxPriorityFeePerGas: tip, maxFeePerGas: ((b.baseFeePerGas ?? 1_000_000_000n) * 125n) / 100n + tip };
}

export function reason(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r?.reason) return r.reason;
    if (/insufficient funds/i.test(e.message)) return `The phone gas wallet is out of ${network === 'mainnet' ? 'ETH' : 'test ETH'}. Top it up from Home.`;
    return e.shortMessage;
  }
  return e instanceof Error ? e.message : String(e);
}

export class PendingTransactionError extends Error {
  constructor(public readonly hash: Hex) {
    super('Submitted on-chain. Confirmation is still pending; do not send it again.');
  }
}

export interface Sent {
  hash: Hex;
  status: 'success' | 'reverted';
}

/** Simulate, send from the gas wallet, and wait for the receipt. onHash fires once it is sent. */
async function call(address: Addr, abi: Abi, functionName: string, args: readonly unknown[], onHash?: (h: Hex) => void): Promise<Sent> {
  const logical = JSON.stringify([address, functionName, args.slice(0, -2)], (_, v) => typeof v === 'bigint' ? v.toString() : v);
  const journal = `kagi.pending.${keccak256(stringToHex(logical)).slice(2)}`;
  const existing = await SecureStore.getItemAsync(journal) as Hex | null;
  const receipt = async (hash: Hex): Promise<Sent> => {
    onHash?.(hash);
    try {
      const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
      await SecureStore.deleteItemAsync(journal);
      return { hash, status: r.status };
    } catch { throw new PendingTransactionError(hash); }
  };
  if (existing) return receipt(existing);
  const w = await walletClient();
  try {
    await pub.simulateContract({ account: w.account, address, abi, functionName, args });
  } catch (e) {
    throw new Error(`The account refused it: ${reason(e)}`);
  }
  const hash = await w.writeContract({ address, abi, functionName, args, chain: CHAIN, ...(await fees()) });
  // Save the public hash before waiting so a retry after restart tracks the same transaction.
  try { await SecureStore.setItemAsync(journal, hash); }
  catch { onHash?.(hash); throw new PendingTransactionError(hash); }
  return receipt(hash);
}

// ---- which account belongs to which key -------------------------------------------------

// One account per network for the same key: testnet keeps its original slot.
const acctKey = (gk: string) => `kagi.account.${network === 'mainnet' ? 'mainnet.' : ''}${gk.slice(0, 32)}`;
const rootKeyName = (rk: string) => `kagi.root.${network === 'mainnet' ? 'mainnet.' : ''}${rk.slice(0, 32)}`;

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
  const hash = await w.sendTransaction({ data, value: fund, gas: (gas * 120n) / 100n, chain: CHAIN, ...(await fees()) });
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
  const hash = await w.sendTransaction({ to, value, chain: CHAIN, ...(await fees()) });
  try {
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    return { hash, status: r.status };
  } catch {
    throw new PendingTransactionError(hash);
  }
}

export async function revoke(account: Addr, agent: Addr, sig: string, onHash?: (h: Hex) => void) {
  return call(account, KagiAccountAbi as Abi, 'revoke', [agent, ...split(sig)], onHash);
}

export async function raiseLimit(account: Addr, m: { agent: Addr; oldCap: bigint; newCap: bigint; expiry: bigint; sig: string }, onHash?: (h: Hex) => void) {
  return call(account, KagiAccountAbi as Abi, 'raiseLimit', [m.agent, m.oldCap, m.newCap, m.expiry, ...split(m.sig)], onHash);
}

export async function declineLimit(account: Addr, agent: Addr, newCap: bigint, sig: string, onHash?: (h: Hex) => void) {
  return call(account, KagiAccountAbi as Abi, 'declineLimit', [agent, newCap, ...split(sig)], onHash);
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
  const hash = await w.sendTransaction({ data, value: fund, gas: (gas * 120n) / 100n, chain: CHAIN, ...(await fees()) });
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

// ---- sweeping ---------------------------------------------------------------------------
// The sponsor key ships in the APK, so anything sent to it can be taken: the owner sweeps it
// home. On mainnet the phone's own gas wallet can be swept too, to take back unspent gas.

export const OWNER_ADDRESS = '0x7aa25897BB2457F46109EF1886b3F0EBB6E5f67E' as const;

export type SweepSource = 'sponsor' | 'gas';

async function sweepAccount(source: SweepSource) {
  if (source === 'sponsor') {
    if (!BUILD_GAS_KEY || !/^0x[0-9a-fA-F]{64}$/.test(BUILD_GAS_KEY)) return null;
    return privateKeyToAccount(BUILD_GAS_KEY as Hex);
  }
  return gasWallet();
}

/** What a sweep would move: the whole balance minus the worst-case fee of one transfer. */
export async function sweepQuote(source: SweepSource) {
  const acct = await sweepAccount(source);
  if (!acct) return null;
  const [balance, fees] = await Promise.all([pub.getBalance({ address: acct.address }), pub.estimateFeesPerGas()]);
  const fee = 21_000n * fees.maxFeePerGas;
  return { address: acct.address, balance, fee, value: balance > fee ? balance - fee : 0n, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
}

/** Send everything from the sponsor or the gas wallet to the owner. */
export async function sweep(source: SweepSource, to: Addr = OWNER_ADDRESS): Promise<Sent> {
  const acct = await sweepAccount(source);
  const q = await sweepQuote(source);
  if (!acct || !q) throw new Error('This build has no sponsor key.');
  if (q.value <= 0n) throw new Error('Nothing to sweep: the balance does not cover the fee.');
  const w = createWalletClient({ account: acct, chain: CHAIN, transport: http(RPC) });
  const hash = await w.sendTransaction({ to, value: q.value, gas: 21_000n, maxFeePerGas: q.maxFeePerGas, maxPriorityFeePerGas: q.maxPriorityFeePerGas, chain: CHAIN });
  try {
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
    return { hash, status: r.status };
  } catch {
    throw new PendingTransactionError(hash);
  }
}
