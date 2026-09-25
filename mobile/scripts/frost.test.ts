// Plays both parties many times and checks every signature with a stock BIP340 verifier.
// Run: npx tsx scripts/frost.test.ts
import { randomBytes } from 'node:crypto';
import { combine, dkgFinish, dkgStart, grantCanonical, messageFor, nonces, reference, txCanonical } from '../src/lib/frost';

const rand = (n: number) => new Uint8Array(randomBytes(n));
let ok = 0;
for (let round = 0; round < 40; round++) {
  const phone = dkgStart(rand);
  const wrist = reference.dkg(rand, phone.X, phone.pop);
  const share = dkgFinish(phone, wrist.reply.X, wrist.reply.pop);
  if (share.groupKey !== wrist.groupKey) throw new Error('group keys differ');
  for (let j = 0; j < 5; j++) {
    const m = messageFor(j % 2 ? grantCanonical('trader', '0x02ab', 500, 24) : txCanonical('0xabc', `0xa9059cbb${j}`));
    const mine = nonces(rand);
    const w = reference.sign(rand, wrist.x, wrist.groupKey, m, mine.D, mine.E);
    combine(share, m, mine, w);
    ok++;
  }
}
// A wrong wrist share must be caught.
const phone = dkgStart(rand);
const wrist = reference.dkg(rand, phone.X, phone.pop);
const share = dkgFinish(phone, wrist.reply.X, wrist.reply.pop);
const m = messageFor('tx|x|y');
const mine = nonces(rand);
const w = reference.sign(rand, wrist.x + 1n, wrist.groupKey, m, mine.D, mine.E);
let caught = false;
try {
  combine(share, m, mine, w);
} catch {
  caught = true;
}
if (!caught) throw new Error('bad share was not caught');
console.log(`${ok} signatures verified with BIP340, bad share rejected`);
