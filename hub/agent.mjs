// The agent. Stand-in for an AI agent that holds money through Leash.
// It makes its own ephemeral key for every grant it asks for. The private half stays with
// the agent (its own gitignored file, hub/.agent-keys.json, mode 600) and is never sent
// anywhere: the phone only ever sees the address. Keys are useless after their expiry.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { encodePacked, keccak256 } from 'viem';
import { generatePrivateKey, privateKeyToAccount, sign } from 'viem/accounts';

const FILE = new URL('./.agent-keys.json', import.meta.url);
const keys = new Map(Object.entries(existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {}));
const persist = () => writeFileSync(FILE, JSON.stringify(Object.fromEntries(keys), null, 2), { mode: 0o600 });

export function newKey() {
  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  keys.set(address.toLowerCase(), pk);
  persist();
  return address;
}

export const has = (address) => keys.has(String(address).toLowerCase());

/** Sign a spend the Leash account will check: keccak256("LEASH/spend" || chainid || account || agent || nonce || to || value). */
export async function signSpend({ chainId, account, agent, nonce, to, value }) {
  const pk = keys.get(String(agent).toLowerCase());
  if (!pk) throw new Error('This agent no longer holds that key. Issue a new one.');
  const hash = keccak256(
    encodePacked(['string', 'uint256', 'address', 'address', 'uint256', 'address', 'uint256'], ['LEASH/spend', BigInt(chainId), account, agent, BigInt(nonce), to, BigInt(value)]),
  );
  return sign({ hash, privateKey: pk });
}
