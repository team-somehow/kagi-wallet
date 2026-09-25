// The Leash MCP. Tools an agent (or the web chat) uses to move money within its session.
// It never takes a private key: the agent signs spends itself, the relayer only submits them,
// and the account contract checks every signature and the cap.
import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { encodePacked, formatEther, getAddress, isAddress, keccak256, parseEther } from 'viem';
import { z } from 'zod';
import * as evm from './evm.mjs';
import * as limits from './limits.mjs';

const contacts = () => JSON.parse(readFileSync(new URL('./contacts.json', import.meta.url), 'utf8'));
const eth = (wei) => `${formatEther(BigInt(wei))} ETH`;
let activity = () => undefined; // set by the hub: pushes agent activity to phones
export const onActivity = (fn) => (activity = fn);

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data });

function resolveRecipient(to) {
  if (isAddress(to)) return { address: getAddress(to), label: null };
  const book = contacts();
  const key = Object.keys(book).find((k) => k.toLowerCase() === String(to).trim().toLowerCase());
  return key ? { address: getAddress(book[key]), label: key } : null;
}

async function describe(agentAddr) {
  const who = evm.findAgent(agentAddr);
  if (!who) return { found: false };
  const s = await evm.sessionOf(who.account, who.address);
  return {
    found: true,
    agent: who.address,
    name: who.name,
    account: who.account,
    network: 'Sepolia',
    chainId: evm.CHAIN_ID,
    status: s.status,
    cap: s.cap.toString(),
    spent: s.spent.toString(),
    remaining: s.remaining.toString(),
    capEth: eth(s.cap),
    remainingEth: eth(s.remaining),
    expiry: Number(s.expiry),
    now: Number(s.now),
    accountBalance: s.balance.toString(),
    sessionNonce: s.nonce.toString(),
    contacts: contacts(),
    explorer: evm.EXPLORER,
  };
}

export function createServer() {
  const server = new McpServer({ name: 'leash', version: '0.1.0' });
  const agentArg = z.string().describe('The session key address (0x…), not the private key.');

  server.registerTool(
    'leash_session',
    {
      title: 'Session',
      description: 'The wallet, network, allowance, spend and expiry for a session key address.',
      inputSchema: { agent: agentArg },
    },
    async ({ agent }) => ok(await describe(agent)),
  );

  server.registerTool(
    'leash_prepare_transfer',
    {
      title: 'Prepare a transfer',
      description:
        'Check a plain ETH transfer against the session and return the digest the agent must sign. ' +
        'Returns ok:false with a reason (over_allowance, expired, revoked, insufficient_funds, unknown_recipient) when it cannot go through.',
      inputSchema: { agent: agentArg, to: z.string().describe('0x address or a contact name, e.g. ABC'), amountEth: z.string() },
    },
    async ({ agent, to, amountEth }) => {
      const d = await describe(agent);
      if (!d.found) return ok({ ok: false, reason: 'unknown_session' });
      const rcpt = resolveRecipient(to);
      if (!rcpt) return ok({ ok: false, reason: 'unknown_recipient', message: `No contact called "${to}". Known: ${Object.keys(d.contacts).join(', ')}.` });
      let value;
      try {
        value = parseEther(amountEth);
      } catch {
        return ok({ ok: false, reason: 'bad_amount' });
      }
      if (value <= 0n) return ok({ ok: false, reason: 'bad_amount' });
      if (d.status !== 'active') return ok({ ok: false, reason: d.status });
      if (value > BigInt(d.remaining)) {
        // Propose a total that covers this transfer with room to spare: double what it needs.
        const proposed = (BigInt(d.spent) + value) * 2n;
        return ok({ ok: false, reason: 'over_allowance', remaining: d.remaining, needed: value.toString(), proposedCap: proposed.toString(), proposedCapEth: eth(proposed) });
      }
      if (value > BigInt(d.accountBalance)) return ok({ ok: false, reason: 'insufficient_funds', balance: d.accountBalance });
      const digest = keccak256(
        encodePacked(
          ['string', 'uint256', 'address', 'address', 'uint256', 'address', 'uint256'],
          ['LEASH/spend', BigInt(d.chainId), d.account, d.agent, BigInt(d.sessionNonce), rcpt.address, value],
        ),
      );
      return ok({ ok: true, digest, sessionNonce: d.sessionNonce, to: rcpt.address, toLabel: rcpt.label, value: value.toString(), valueEth: eth(value) });
    },
  );

  server.registerTool(
    'leash_submit_transfer',
    {
      title: 'Submit a signed transfer',
      description: 'Send a transfer the agent signed (65-byte signature over the prepared digest). Returns once the receipt is in.',
      inputSchema: { agent: agentArg, to: z.string(), value: z.string(), sessionNonce: z.string(), signature: z.string() },
    },
    async ({ agent, to, value, sessionNonce, signature }) => {
      const who = evm.findAgent(agent);
      if (!who) return ok({ status: 'failed', reason: 'unknown_session' });
      const s = await evm.sessionOf(who.account, who.address);
      // A retry after an unknown outcome: if the nonce moved, the earlier attempt landed.
      if (s.nonce.toString() !== sessionNonce) return ok({ status: 'stale', reason: 'The session nonce moved; prepare the transfer again.' });
      const sig = signature.replace(/^0x/, '');
      if (sig.length !== 130) return ok({ status: 'failed', reason: 'bad_signature' });
      const r = `0x${sig.slice(0, 64)}`;
      const sv = `0x${sig.slice(64, 128)}`;
      let v = parseInt(sig.slice(128), 16);
      if (v < 27) v += 27;
      activity({ t: 'agent_activity', src: 'hub', kind: 'transfer', status: 'submitted', agent: who.address, name: who.name, to, value, at: Date.now() });
      try {
        const res = await evm.spendSigned(who.account, { agent: who.address, to, value, v, r, s: sv });
        const status = res.status === 'success' ? 'confirmed' : 'failed';
        activity({ t: 'agent_activity', src: 'hub', kind: 'transfer', status, agent: who.address, name: who.name, to, value, hash: res.hash, at: Date.now() });
        return ok({ status, hash: res.hash, link: `${evm.EXPLORER}/tx/${res.hash}` });
      } catch (e) {
        const why = e?.message ?? String(e);
        activity({ t: 'agent_activity', src: 'hub', kind: 'transfer', status: 'failed', agent: who.address, name: who.name, to, value, error: why, at: Date.now() });
        return ok({ status: 'failed', reason: /over the cap/.test(why) ? 'over_allowance' : why });
      }
    },
  );

  server.registerTool(
    'leash_request_limit',
    {
      title: 'Ask for a higher limit',
      description: "Ask the owner to raise the session's total allowance. The owner approves on the Leash stick. Returns a request id to wait on.",
      inputSchema: {
        agent: agentArg,
        newCap: z.string().describe('The new total allowance, in wei.'),
        reason: z.string(),
        transfer: z.object({ to: z.string(), value: z.string(), toLabel: z.string().nullable().optional() }).optional(),
      },
    },
    async ({ agent, newCap, reason, transfer }) => {
      try {
        const r = await limits.create({ agent, newCap, reason, transfer });
        return ok({ requestId: r.id, status: r.status, oldCap: r.oldCap, newCap: r.newCap });
      } catch (e) {
        return ok({ status: 'failed', reason: e?.message ?? String(e) });
      }
    },
  );

  server.registerTool(
    'leash_wait_for_limit',
    {
      title: 'Wait for the owner',
      description: 'Wait for a limit request to be confirmed on-chain, rejected or to lapse. Returns the current state after timeoutSeconds.',
      inputSchema: { requestId: z.string(), timeoutSeconds: z.number().min(1).max(120).default(60) },
    },
    async ({ requestId, timeoutSeconds }) => {
      const r = await limits.wait(requestId, timeoutSeconds * 1000);
      if (!r) return ok({ status: 'unknown_request' });
      return ok({ status: r.status, hash: r.hash, error: r.error, newCap: r.newCap, link: r.hash ? `${evm.EXPLORER}/tx/${r.hash}` : null });
    },
  );

  return server;
}
