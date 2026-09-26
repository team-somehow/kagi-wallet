// Intercepta (Web3 Antivirus): screens who the agent is about to pay, before the session key
// signs anything. The verdict picks the rung of Kagi's ladder the payment goes to:
//
//   pass   the agent pays on its own, within its cap
//   hold   the agent doesn't sign. The owner gets a limit request carrying the reasons and must
//          approve on the phone and the stick, even when the payment fits under the cap
//   block  refused outright: no signature, no request. The reasons go back to the AI
//
// Intercepta's risk data covers mainnet, so it screens the destination as a mainnet address even
// though the payment itself runs on a testnet. If Intercepta can't be reached, the payment is
// held: an outage puts a person in the loop, it never waves a payment through.
//
//   INTERCEPTA_API_KEY   free key from intercepta.io/ethglobal
//   INTERCEPTA_URL       default https://api.web3antivirus.io
//   RISK_HOLD            quick-scan toxicScore at or above which a payment is held, default 30

const KEY = process.env.INTERCEPTA_API_KEY?.trim() || null;
const BASE = (process.env.INTERCEPTA_URL?.trim() || 'https://api.web3antivirus.io').replace(/\/+$/, '');
const HOLD = Number(process.env.RISK_HOLD ?? 30);

// Only these refuse a payment: the destination itself is sanctioned or runs scams. Everything
// else (having received phishing dust, touching a mixer or a sanctioned address) is exposure,
// not guilt, so a person decides. The score doesn't refuse on its own: the deep scan scores a
// phishing victim 100 too.
const BLOCK_TRAITS = new Set(['sanction_address', 'known_scammer', 'blacklist', 'rug_pull', 'initiator_scam_transactions', 'suspicious_deployer']);

export const interceptaEnabled = () => Boolean(KEY);

const cache = new Map(); // address -> { at, result }
const CACHE_MS = 10 * 60 * 1000;

async function scan(address, kind) {
  const r = await fetch(`${BASE}/api/public/v2/extension/account/${address}/${kind}`, {
    headers: { 'X-API-KEY': KEY, accept: 'application/json' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`Intercepta ${kind}: HTTP ${r.status}`);
  return r.json();
}

const traitLabel = (t) => t.name.replace(/_/g, ' ');

/**
 * Screen a payment destination. Quick scan first; anything it flags gets a deep scan
 * (sanctions, AML and scam exposure) so the owner sees the full reasons.
 */
export async function screen(address) {
  const a = address.toLowerCase();
  const hit = cache.get(a);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  let result;
  try {
    const quick = await scan(a, 'quick-scan');
    const score = Number(quick.toxicScore ?? 0);
    let data = quick;
    let depth = 'quick';
    const refused = quick.traits?.some((t) => BLOCK_TRAITS.has(t.name));
    if (!refused && (score >= HOLD || quick.traits?.length)) {
      // Only worth the second call when the answer isn't already "refuse". If the deep scan
      // fails (the free tier rate-limits hard), decide on the quick scan we already have.
      try {
        data = await scan(a, 'toxic-score');
        depth = 'deep';
      } catch {
        // keep the quick result
      }
    }
    const traits = (data.traits ?? []).map((t) => ({ name: t.name, risk: t.risk, txs: t.txsCount, description: t.description }));
    const blocking = traits.filter((t) => BLOCK_TRAITS.has(t.name));
    const verdict = blocking.length ? 'block' : score >= HOLD || traits.length ? 'hold' : 'pass';
    const shown = (blocking.length ? blocking : traits).slice(0, 3).map(traitLabel);
    result = {
      verdict,
      score,
      traits,
      summary: verdict === 'pass' ? `clean (risk score ${score})` : `risk score ${score}${shown.length ? `: ${shown.join(', ')}` : ''}`,
      depth,
    };
  } catch (e) {
    // Fail towards a person, never towards paying.
    result = { verdict: 'hold', score: null, traits: [], summary: `screening unavailable (${e.message})`, depth: 'error' };
  }
  if (result.depth !== 'error') cache.set(a, { at: Date.now(), result });
  return result;
}
