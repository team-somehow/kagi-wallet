// Writes contracts/test/fixtures/frost.json: signatures made by the real phone + wrist FROST
// code (mobile/src/lib/frost), for the forge tests to check against the Solidity contracts.
// This is what keeps the TypeScript message builders and the contracts' digests in step.
// Run: npx tsx gen-fixtures.ts
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { combine, dkgFinish, dkgStart, evm1271Message, evmGrantMessage, evmMessage, evmRevokeMessage, nonces, phoneKey, phoneOnlySign, reference } from '../mobile/src/lib/frost';

const rand = (n: number) => new Uint8Array(randomBytes(n));
const phone = dkgStart(rand);
const wrist = reference.dkg(rand, phone.X, phone.pop);
const share = dkgFinish(phone, wrist.reply.X, wrist.reply.pop);
const managerSign = (m: Uint8Array) => {
  const n = nonces(rand);
  const w = reference.sign(rand, wrist.x, wrist.groupKey, m, n.D, n.E);
  return `0x${combine(share, m, n, w)}`;
};

const chainId = 11155111;
const account = '0x1ea5000000000000000000000000000000001ea5';
const agent = '0x00000000000000000000000000000000000a6e17';
const to = '0x000000000000000000000000000000000000dEaD';
const cap = 10n ** 13n;
const expiry = 2_000_000_000n;
const data = '0xabcdef';
const hash = `0x${'11'.repeat(32)}`;

const fixture = {
  chainId,
  account,
  groupKey: `0x${share.groupKey}`,
  phoneKey: `0x${phoneKey(share)}`,
  agent,
  to,
  cap: cap.toString(),
  expiry: expiry.toString(),
  data,
  hash,
  // nonce 0, 1, 2 in this order on one account
  grantSig: managerSign(evmGrantMessage({ chainId, account, nonce: 0n, agent, cap, expiry })),
  executeSig: managerSign(evmMessage({ chainId, account, nonce: 1n, to, value: 1n, data })),
  revokeSig: `0x${phoneOnlySign(share, evmRevokeMessage(chainId, account, 2n, agent), rand)}`,
  sig1271: managerSign(evm1271Message(chainId, account, hash)),
};
writeFileSync(new URL('../contracts/test/fixtures/frost.json', import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`);
console.log('wrote contracts/test/fixtures/frost.json');
