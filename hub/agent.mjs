// The agent. Stand-in for an AI agent that holds money through Leash.
// It makes its own ephemeral key for every grant it asks for. The private half lives only
// in this process's memory and is never sent anywhere: the phone only ever sees the address.
import { encodePacked, keccak256 } from 'viem';
import { generatePrivateKey, privateKeyToAccount, sign } from 'viem/accounts';

const keys = new Map(); // address -> private key, in memory only

export function newKey() {
  const pk = generatePrivateKey();
  const address = privateKeyToAccount(pk).address;
  keys.set(address.toLowerCase(), pk);
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
