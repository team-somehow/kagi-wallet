/** Real testnet agent, run locally on the phone. It cannot sign manager approvals. */
import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';
import { createWalletClient, encodePacked, http, keccak256, type Hex } from 'viem';
import { privateKeyToAccount, sign } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { KagiAccountAbi } from './contracts';
import { loadSessionKey } from './session';
import * as evm from './evm';

export const DEMO_RECIPIENT = '0xBB0Dd7ca77B6BD6c1AC7F5727139D8D51228DCe0' as const; // ABC in agent-mcp/contacts.json
const STORAGE = 'kagi.agent-demo.v1';
const MICRO = 1_000_000_000_000n;
type Job = {
  account: Hex;
  agent: Hex;
  amounts: number[];
  index: number;
  pending?: { hash: Hex; kind: 'spend' | 'request'; newCap?: string };
  waiting?: { newCap: string; fromBlock: string };
  completed?: boolean;
  outcome?: 'confirmed' | 'declined' | 'session-ended';
};
type State = { running: boolean; message: string; hash?: Hex; saved: boolean };
let snapshot: State = {
  running: false,
  message: 'Send 2 µETH, then 8 µETH to ABC. The second transfer requests more access when it exceeds the allowance.',
  saved: false,
};
const listeners = new Set<() => void>();
const publish = (patch: Partial<State>) => {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};
export const useAgentDemo = () =>
  useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
const save = (job: Job) => SecureStore.setItemAsync(STORAGE, JSON.stringify(job));
export async function restoreAgentDemo() {
  const raw = await SecureStore.getItemAsync(STORAGE);
  if (raw && !snapshot.running) {
    const job: Job = JSON.parse(raw);
    // Recover runs marked complete by the earlier approval-timeout behavior.
    // A declined request remains stopped; only an expired request is retryable.
    if (job.completed && !job.outcome && job.waiting && job.index < job.amounts.length) {
      const block = await evm.pub.getBlock();
      const events = await evm.events(job.account, BigInt(job.waiting.fromBlock), block.number);
      const declined = events.some((e) => e.kind === 'declined' && e.agent.toLowerCase() === job.agent.toLowerCase() && e.newCap === BigInt(job.waiting!.newCap));
      if (!declined && block.number - BigInt(job.waiting.fromBlock) > 50n) {
        job.completed = false;
        delete job.waiting;
        await save(job);
      }
    }
    publish({
      saved: !job.completed,
      hash: job.pending?.hash,
      message: job.completed
        ? job.index === job.amounts.length
          ? 'Transfers confirmed. See Wallet activity for their receipts.'
          : 'Last run stopped. The remaining transfer was not sent.'
        : 'A run is saved. Resume it to check the pending transaction and continue.',
    });
  }
}

export async function runAgentDemo(account: Hex, agent: Hex, secondAct = false) {
  if (snapshot.running) return;
  publish({ running: true, hash: undefined, message: 'Checking the session and on-chain balance…' });
  try {
    const raw = await SecureStore.getItemAsync(STORAGE);
    const previous: Job | null = raw ? JSON.parse(raw) : null;
    let job: Job;
    if (previous && !previous.completed) {
      if (previous.account !== account || previous.agent.toLowerCase() !== agent.toLowerCase())
        throw new Error('Resume the saved run with its original session key before starting another.');
      job = previous;
    } else {
      const s = await evm.session(account, agent);
      if (!secondAct && (s.cap !== 5n * MICRO || s.spent !== 0n))
        throw new Error('Act one needs a fresh 5 µETH session key. Create one from Agent access.');
      if (secondAct && (s.cap !== 20n * MICRO || s.spent !== 10n * MICRO))
        throw new Error('Act two follows act one: 20 µETH total allowance, 10 µETH already spent.');
      const need = (secondAct ? 12n : 10n) * MICRO;
      if ((await evm.pub.getBalance({ address: account })) < need)
        throw new Error(`Top up the wallet first. This act sends ${secondAct ? 12 : 10} µETH in total.`);
      job = { account, agent, amounts: secondAct ? [12] : [2, 8], index: 0 };
      await save(job);
    }
    const key = await loadSessionKey(job.agent);
    if (!key) throw new Error('The session key is not saved on this phone.');
    const signer = privateKeyToAccount(key.privateKey as Hex);
    const wallet = createWalletClient({
      account: signer,
      chain: sepolia,
      transport: http(process.env.EXPO_PUBLIC_SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'),
    });
    const send = async (kind: 'spend' | 'request', args: readonly unknown[], newCap?: bigint) => {
      const functionName = kind === 'spend' ? 'spend' : 'requestLimit';
      const { request } = await evm.pub.simulateContract({
        account: signer,
        address: job.account,
        abi: KagiAccountAbi,
        functionName,
        args,
      } as any);
      const block = await evm.pub.getBlock();
      const tip = 1_000_000n;
      const hash = await wallet.writeContract({
        ...request,
        chain: sepolia,
        maxPriorityFeePerGas: tip,
        maxFeePerGas: ((block.baseFeePerGas ?? 1_000_000_000n) * 125n) / 100n + tip,
      } as any);
      job.pending = { hash, kind, newCap: newCap?.toString() };
      await save(job);
      publish({
        hash,
        message:
          kind === 'spend'
            ? 'Transfer submitted. Waiting for its receipt…'
            : 'Limit request submitted. Waiting for the chain…',
      });
    };
    while (job.index < job.amounts.length) {
      if (job.pending) {
        publish({ hash: job.pending.hash, message: 'Tracking the submitted transaction…' });
        const receipt = await evm.pub.waitForTransactionReceipt({ hash: job.pending.hash, timeout: 90_000 });
        const pending = job.pending;
        delete job.pending;
        if (receipt.status !== 'success') {
          await save(job);
          throw new Error('The transaction reverted. Resume to recheck the current allowance.');
        }
        if (pending.kind === 'spend') job.index++;
        else job.waiting = { newCap: pending.newCap!, fromBlock: receipt.blockNumber.toString() };
        await save(job);
        continue;
      }
      const session = await evm.session(job.account, job.agent);
      const block = await evm.pub.getBlock();
      if (session.expiry <= block.timestamp) {
        job.completed = true;
        job.outcome = 'session-ended';
        await save(job);
        throw new Error('This session expired or was revoked. No further transfers were sent.');
      }
      if (job.waiting) {
        if (session.cap >= BigInt(job.waiting.newCap)) {
          delete job.waiting;
          await save(job);
          continue;
        }
        const events = await evm.events(job.account, BigInt(job.waiting.fromBlock), block.number);
        if (
          events.some(
            (e) =>
              e.kind === 'declined' &&
              e.agent.toLowerCase() === job.agent.toLowerCase() &&
              e.newCap === BigInt(job.waiting!.newCap),
          )
        ) {
          job.completed = true;
          job.outcome = 'declined';
          await save(job);
          publish({ saved: false, message: 'Declined. The waiting transfer was not sent.' });
          return;
        }
        if (block.number - BigInt(job.waiting.fromBlock) > 50n) {
          delete job.waiting;
          await save(job);
          throw new Error('The approval request expired. Resume to request approval again; confirmed transfers will not repeat.');
        }
        publish({
          message: `Agent paused. Approve ${(BigInt(job.waiting.newCap) / MICRO).toString()} µETH total on your devices, or decline on the phone.`,
          saved: true,
        });
        await new Promise((resolve) => setTimeout(resolve, 4000));
        continue;
      }
      const value = BigInt(job.amounts[job.index]) * MICRO;
      if (session.spent + value > session.cap) {
        const newCap = (session.spent + value) * 2n;
        await send('request', [newCap, `In-app test agent: send ${job.amounts[job.index]} microETH to ABC.`], newCap);
        continue;
      }
      const digest = keccak256(
        encodePacked(
          ['string', 'uint256', 'address', 'address', 'uint256', 'address', 'uint256'],
          ['KAGI/spend', BigInt(evm.CHAIN_ID), job.account, job.agent, session.nonce, DEMO_RECIPIENT, value],
        ),
      );
      const sig = await sign({ hash: digest, privateKey: key.privateKey as Hex });
      await send('spend', [job.agent, DEMO_RECIPIENT, value, Number(sig.v), sig.r, sig.s]);
    }
    job.completed = true;
    job.outcome = 'confirmed';
    await save(job);
    publish({ saved: false, message: 'Transfers confirmed. Open Wallet activity to see each on-chain receipt.' });
  } catch (e) {
    const stored = await SecureStore.getItemAsync(STORAGE).catch(() => null);
    const unfinished = stored ? !(JSON.parse(stored) as Job).completed : false;
    publish({
      saved: unfinished,
      message: evm.reason(e) + (unfinished ? ' Resume to check the saved run before sending anything else.' : ''),
    });
  } finally {
    publish({ running: false });
  }
}
