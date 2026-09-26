// The two services the agent MCP calls, laid out as the system they make: Intercepta decides who an
// agent may pay, Curvegrid's MultiBaas remembers what it did. Facts here follow agent-mcp/intercepta.mjs
// and agent-mcp/multibaas.mjs; the demo verdicts are the addresses in the README.
import { REPO_URL } from '../data';

const src = (path: string) => `${REPO_URL}/blob/main/${path}`;

export const PARTNER_LOGOS = [
  { name: 'Intercepta', logo: './partners/intercepta-dark.png', width: 147, height: 35, href: 'https://intercepta.io' },
  { name: 'Curvegrid', logo: './partners/curvegrid-dark.png', width: 152, height: 35, href: 'https://www.curvegrid.com/multibaas' },
];

/** The small "Built with" row under the hero. */
export function BuiltWith() {
  return (
    <p className="built-with">
      <span>Built with</span>
      {PARTNER_LOGOS.map((p) => (
        <a key={p.name} href="#partners">
          <img src={p.logo} alt={p.name} width={p.width * 0.6} height={p.height * 0.6} />
        </a>
      ))}
    </p>
  );
}

const FLOW = [
  { n: '01', who: 'Agent', what: 'Asks to pay', how: 'With its own capped key' },
  { n: '02', who: 'Intercepta', what: 'Screens the recipient', how: 'Before anything is signed' },
  { n: '03', who: 'Kagi', what: 'Pays, holds or refuses', how: 'Held payments wait for your Kagi Wallet' },
  { n: '04', who: 'Curvegrid', what: 'Records and totals it', how: 'For your AI and the Spending tab' },
];

type Verdict = { who: string; addr: string; verdict: 'Pass' | 'Hold' | 'Refuse'; why: string };
type Partner = {
  id: string;
  logo: (typeof PARTNER_LOGOS)[number];
  title: [string, string];
  lede: string;
  steps: { h: string; p: string }[];
  verdicts?: Verdict[];
  shot?: { src: string; alt: string };
  links: { label: string; href: string }[];
};

const PARTNERS: Partner[] = [
  {
    id: 'intercepta',
    logo: PARTNER_LOGOS[0],
    title: ['The cap limits how much.', 'Intercepta decides who.'],
    lede: 'Every recipient is screened before the agent’s key signs.',
    steps: [
      { h: 'Clean', p: 'paid within the cap, no one in the loop.' },
      { h: 'Risky', p: 'held until you approve on your Kagi Wallet.' },
      { h: 'Sanctioned or scam', p: 'refused. Nothing is signed.' },
    ],
    verdicts: [
      { who: 'Gas sponsor wallet', addr: '0xBB0D…DCe0', verdict: 'Pass', why: 'Risk 0' },
      { who: 'Phishing exposure', addr: '0x7aa2…f67E', verdict: 'Hold', why: 'Risk 45' },
      { who: 'Tornado Cash', addr: '0x098B…2f96', verdict: 'Refuse', why: 'Sanctioned' },
    ],
    links: [
      { label: 'Screening code', href: src('agent-mcp/intercepta.mjs') },
      { label: 'Held-payment screen', href: src('mobile/src/app/limit/[id].tsx') },
    ],
  },
  {
    id: 'curvegrid',
    logo: PARTNER_LOGOS[1],
    title: ['The chain knows the balance.', 'MultiBaas knows the story.'],
    lede: 'Every payment and approval, indexed and totalled.',
    steps: [
      { h: 'Your AI', p: 'answers “what did my agent spend?” from records.' },
      { h: 'Your phone', p: 'shows it in the Spending tab.' },
      { h: 'Every wallet', p: 'indexed from its first payment.' },
    ],
    shot: {
      src: './app/spending.png',
      alt: 'The Spending tab in the Kagi app: what agents spent, limits, top recipients and approvals, totalled by Curvegrid MultiBaas.',
    },
    links: [
      { label: 'MultiBaas client', href: src('agent-mcp/multibaas.mjs') },
      { label: 'Spending tab', href: src('mobile/src/app/(tabs)/spending.tsx') },
    ],
  },
];

export function Partners() {
  return (
    <section className="section" id="partners">
      <div className="wrap">
        <div className="section-head">
          <h2>Two integrations. One boundary.</h2>
          <p>Intercepta screens who an agent pays. Curvegrid’s MultiBaas remembers what it did.</p>
        </div>

        <ol className="flow" aria-label="How a payment moves through the system">
          {FLOW.map((f) => (
            <li key={f.n}>
              <span className="flow-n">
                {f.n} / {f.who}
              </span>
              <b>{f.what}</b>
              <span>{f.how}</span>
            </li>
          ))}
        </ol>

        <div className="integrations">
          {PARTNERS.map((p) => (
            <article key={p.id} className="integration panel" aria-labelledby={`int-${p.id}`}>
              <div className="int-copy">
                <a className="int-logo" href={p.logo.href} target="_blank" rel="noreferrer">
                  <img src={p.logo.logo} alt={p.logo.name} width={p.logo.width} height={p.logo.height} />
                </a>
                <h3 id={`int-${p.id}`}>
                  {p.title[0]} <span>{p.title[1]}</span>
                </h3>
                <p className="int-lede">{p.lede}</p>
                <ul className="int-steps">
                  {p.steps.map((s) => (
                    <li key={s.h}>
                      <b>{s.h}</b> {s.p}
                    </li>
                  ))}
                </ul>
                <p className="int-links">
                  {p.links.map((l) => (
                    <a key={l.href} href={l.href} target="_blank" rel="noreferrer">
                      {l.label} <span aria-hidden="true">↗</span>
                    </a>
                  ))}
                </p>
              </div>

              <div className="int-visual">
                {p.verdicts ? (
                  <ul className="int-verdicts" aria-label="Live verdicts">
                    {p.verdicts.map((v) => (
                      <li key={v.addr}>
                        <span className="v-who">
                          <b>{v.who}</b>
                          <code>{v.addr}</code>
                        </span>
                        <span className={`v-chip v-${v.verdict.toLowerCase()}`}>
                          {v.verdict}
                          <small>{v.why}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {p.shot ? <img className="int-shot" src={p.shot.src} alt={p.shot.alt} width={540} height={1125} loading="lazy" /> : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
