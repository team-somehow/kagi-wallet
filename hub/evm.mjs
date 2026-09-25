// Sepolia side of the hub. The relayer (hub/.relayer, gitignored) pays gas. It can only
// deploy accounts and submit what phone, wrist or agent already signed; the account
// contract checks every signature itself, so the relayer cannot move funds on its own.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, formatEther, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import * as agent from './agent.mjs';

const url = (f) => new URL(f, import.meta.url);
const RPC = process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com';
const art = JSON.parse(readFileSync(url('./LeashAccount.json'), 'utf8'));
const STATE = url('./.evm.json');
const VERSION = 3;
const relayer = existsSync(url('./.relayer')) ? privateKeyToAccount(readFileSync(url('./.relayer'), 'utf8').trim()) : null;
const pub = createPublicClient({ chain: sepolia, transport: http(RPC) });
const wallet = relayer ? createWalletClient({ account: relayer, chain: sepolia, transport: http(RPC) }) : null;
export const EXPLORER = 'https://sepolia.etherscan.io';

const load = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {});
const save = (s) => writeFileSync(STATE, JSON.stringify(s, null, 2));
const entry = (gk) => {
  const e = load()[gk];
  return e?.version === VERSION ? e : null;
};
const accountOf = (gk) => {
  const a = entry(gk)?.account;
  if (!a) throw new Error('No Leash account deployed for this wallet.');
  return a;
};

// Frugal fees: just above the current base fee, a tiny tip.
async function fees() {
  const b = await pub.getBlock();
  const tip = 1_000_000n;
  return { maxPriorityFeePerGas: tip, maxFeePerGas: (b.baseFeePerGas * 125n) / 100n + tip };
}

function reason(e) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (r?.reason) return r.reason;
    return e.shortMessage;
  }
  return e?.message ?? String(e);
}

async function send(address, functionName, args, gas) {
  const acct = relayer;
  // Simulate first so anything the contract would refuse costs nothing.
  try {
    await pub.simulateContract({ account: acct, address, abi: art.abi, functionName, args });
  } catch (e) {
    throw new Error(`The account refused it: ${reason(e)}`);
  }
  const hash = await wallet.writeContract({ address, abi: art.abi, functionName, args, gas, ...(await fees()) });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  return { hash, status: r.status, gasUsed: r.gasUsed.toString(), block: r.blockNumber.toString() };
}

const split = (sig) => [BigInt(`0x${sig.slice(0, 64)}`), BigInt(`0x${sig.slice(64)}`)];

export async function info(gk) {
  const e = entry(gk);
  const account = e?.account ?? null;
  const [relayerBalance, accountBalance, nonce, block] = await Promise.all([
    relayer ? pub.getBalance({ address: relayer.address }) : 0n,
    account ? pub.getBalance({ address: account }) : 0n,
    account ? pub.readContract({ address: account, abi: art.abi, functionName: 'nonce' }) : 0n,
    pub.getBlock(),
  ]);
  const sessions = [];
  for (const a of e?.agents ?? []) {
    const [cap, spent, expiry, sn] = await pub.readContract({ address: account, abi: art.abi, functionName: 'session', args: [a.address] });
    sessions.push({ ...a, cap: cap.toString(), spent: spent.toString(), expiry: expiry.toString(), nonce: sn.toString(), held: agent.has(a.address) });
  }
  const f = block.baseFeePerGas + 1_000_000n;
  return {
    t: 'evm_info',
    chainId: sepolia.id,
    now: block.timestamp.toString(),
    relayer: relayer?.address ?? null,
    relayerBalance: relayerBalance.toString(),
    account,
    accountBalance: accountBalance.toString(),
    nonce: nonce.toString(),
    sessions,
    deployCost: (960_000n * f).toString(),
    grantCost: (110_000n * f).toString(),
    spendCost: (90_000n * f).toString(),
    explorer: EXPLORER,
  };
}

export async function deploy(gk, phoneKey, fundWei) {
  if (!wallet) throw new Error('No relayer key in hub/.relayer.');
  const hash = await wallet.deployContract({
    abi: art.abi,
    bytecode: `${art.bytecode}${gk.padStart(64, '0')}${String(phoneKey).padStart(64, '0')}`,
    value: BigInt(fundWei ?? 0),
    gas: 1_100_000n,
    ...(await fees()),
  });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy failed in ${hash}`);
  const st = load();
  st[gk] = { version: VERSION, account: r.contractAddress, deployTx: hash, agents: [] };
  save(st);
  return { t: 'evm_deployed', account: r.contractAddress, hash };
}

/** The agent makes a fresh ephemeral key and asks for a grant. Only the address leaves the agent. */
export function agentKey(name) {
  return { t: 'evm_agent_key', agent: agent.newKey(), name };
}

export async function grant(gk, m) {
  const account = accountOf(gk);
  const r = await send(account, 'grant', [m.agent, BigInt(m.cap), BigInt(m.expiry), ...split(m.sig)], 130_000n);
  const st = load();
  st[gk].agents = [...(st[gk].agents ?? []).filter((a) => a.address.toLowerCase() !== m.agent.toLowerCase()), { address: m.agent, name: m.name ?? 'agent' }];
  save(st);
  return { t: 'evm_result', what: 'grant', ...r };
}

export async function revoke(gk, m) {
  return { t: 'evm_result', what: 'revoke', ...(await send(accountOf(gk), 'revoke', [m.agent, ...split(m.sig)], 80_000n)) };
}

/** The agent spends on its own. No phone, no wrist: its key and the on-chain cap are enough. */
export async function agentSpend(gk, m) {
  const account = accountOf(gk);
  const [, , , sn] = await pub.readContract({ address: account, abi: art.abi, functionName: 'session', args: [m.agent] });
  const sig = await agent.signSpend({ chainId: sepolia.id, account, agent: m.agent, nonce: sn, to: m.to, value: m.value });
  const r = await send(account, 'spend', [m.agent, m.to, BigInt(m.value), Number(sig.v), sig.r, sig.s], 110_000n);
  return { t: 'evm_result', what: 'spend', ...r };
}

export async function submit(gk, call) {
  const account = accountOf(gk);
  const r = await send(account, 'execute', [call.to, BigInt(call.value), call.data || '0x', ...split(call.sig)], 90_000n);
  return { t: 'evm_result', what: 'execute', ...r };
}

export const fmt = (wei) => `${formatEther(BigInt(wei))} ETH`;

// ---- root treasury: owned by the 3-of-3 root key (phone + wrist + vault) ----------------

const rootArt = JSON.parse(readFileSync(url('./RootTreasury.json'), 'utf8'));
const rootEntry = (rk) => load()[`root:${rk}`] ?? null;

export async function rootInfo(rk) {
  const e = rootEntry(rk);
  const [relayerBalance, balance, nonce] = await Promise.all([
    relayer ? pub.getBalance({ address: relayer.address }) : 0n,
    e ? pub.getBalance({ address: e.account }) : 0n,
    e ? pub.readContract({ address: e.account, abi: rootArt.abi, functionName: 'nonce' }) : 0n,
  ]);
  return { t: 'evm_root_info', chainId: sepolia.id, account: e?.account ?? null, balance: balance.toString(), nonce: nonce.toString(), relayerBalance: relayerBalance.toString(), explorer: EXPLORER };
}

export async function rootDeploy(rk, fundWei) {
  if (!wallet) throw new Error('No relayer key in hub/.relayer.');
  const hash = await wallet.deployContract({
    abi: rootArt.abi,
    bytecode: `${rootArt.bytecode}${rk.padStart(64, '0')}`,
    value: BigInt(fundWei ?? 0),
    gas: 500_000n,
    ...(await fees()),
  });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (r.status !== 'success' || !r.contractAddress) throw new Error(`Deploy failed in ${hash}`);
  const st = load();
  st[`root:${rk}`] = { account: r.contractAddress, deployTx: hash };
  save(st);
  return { t: 'evm_root_deployed', account: r.contractAddress, hash };
}

export async function rootSubmit(rk, m) {
  const e = rootEntry(rk);
  if (!e) throw new Error('No root treasury deployed for this root key.');
  const args = [m.to, BigInt(m.value), '0x', ...split(m.sig)];
  try {
    await pub.simulateContract({ account: relayer, address: e.account, abi: rootArt.abi, functionName: 'execute', args });
  } catch (err) {
    throw new Error(`The treasury refused it: ${reason(err)}`);
  }
  const hash = await wallet.writeContract({ address: e.account, abi: rootArt.abi, functionName: 'execute', args, gas: 90_000n, ...(await fees()) });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 180_000 });
  return { t: 'evm_result', what: 'root_execute', hash, status: r.status, gasUsed: r.gasUsed.toString(), block: r.blockNumber.toString() };
}
