// Root key end to end in JS: 2-of-2 key generation, reshare to 3-of-3 with an ECIES
// hand-off, then 3-party signing, all checked with a stock BIP340 verifier.
import { randomBytes } from 'node:crypto';
import { dkgFinish, dkgStart, reference } from '../src/lib/frost';
import {
  _G, _big, _mod, _randomScalar, _s32, combineRoot, cpt, ecies, eciesOpen, partial, phoneReshare, reshareCheck,
  rootGrantMessage, rootNonces, type Commit, type RootShare, unhex,
} from '../src/lib/root';

const rand = (n: number) => new Uint8Array(randomBytes(n));
for (let round = 0; round < 10; round++) {
  const phone = dkgStart(rand);
  const w = reference.dkg(rand, phone.X, phone.pop);
  const s = dkgFinish(phone, w.reply.X, w.reply.pop);
  const X1 = cpt(_G.multiply(_big(unhex(s.share))));
  const X2 = cpt(_G.multiply(w.x));
  // Vault device key
  const vPriv = _randomScalar(rand);
  const vPub = cpt(_G.multiply(vPriv));
  // Reshare
  const root: RootShare = { share: s.share, groupKey: s.groupKey, parties: 2, pub: { '1': X1, '2': X2 } };
  const ph = phoneReshare(root, vPub, rand);
  const r2 = _randomScalar(rand);
  const x2n = _mod(w.x - r2);
  const X2n = cpt(_G.multiply(x2n));
  const wristSealed = ecies(vPub, unhex(_s32(r2)), rand);
  const x3 = _mod(_big(eciesOpen(vPriv, ph.sealed)) + _big(eciesOpen(vPriv, wristSealed)));
  const X3 = cpt(_G.multiply(x3));
  if (!reshareCheck(s.groupKey, ph.X1, X2n, X3)) throw new Error('reshare moved the group key');
  const r3: RootShare = { share: ph.x1, groupKey: s.groupKey, parties: 3, pub: { '1': ph.X1, '2': X2n, '3': X3 } };
  // Sign
  const m = rootGrantMessage({ chainId: 11155111, account: '0x5d677d257822f5c3aadf2e3484c3f57bd4364adb', nonce: 3n, agent: '0x1111111111111111111111111111111111111111', cap: 10n ** 16n, expiry: 1790000000n });
  const n1 = rootNonces(rand), n2 = rootNonces(rand), n3 = rootNonces(rand);
  const cs: Commit[] = [{ id: 1, D: n1.D, E: n1.E }, { id: 2, D: n2.D, E: n2.E }, { id: 3, D: n3.D, E: n3.E }];
  const z = { 1: partial(r3.share, s.groupKey, m, cs, 1, n1), 2: partial(_s32(x2n), s.groupKey, m, cs, 2, n2), 3: partial(_s32(x3), s.groupKey, m, cs, 3, n3) };
  combineRoot(r3, m, cs, z);
  // The old 2-of-2 shares alone must no longer work
  let caught = false;
  try {
    combineRoot(r3, m, cs, { ...z, 2: partial(_s32(w.x), s.groupKey, m, cs, 2, n2) });
  } catch {
    caught = true;
  }
  if (!caught) throw new Error('an old share was accepted');
}
console.log('10 reshares to 3-of-3 kept the group key; 10 three-party signatures verified; old shares rejected');
