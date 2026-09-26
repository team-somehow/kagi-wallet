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
  { n: '01', who: 'Agent', what: 'Asks to pay', how: 'send_eth through the Kagi MCP, with its own capped key' },
  { n: '02', who: 'Intercepta', what: 'Screens the recipient', how: 'Quick scan, then a deep scan on anything flagged' },
  { n: '03', who: 'Kagi', what: 'Pays, holds or refuses', how: 'Under the cap on its own. Held payments wait for phone + stick' },
  { n: '04', who: 'Curvegrid', what: 'Indexes and totals what happened', how: 'Every spend and approval, for the AI and the Spending screen' },
];

type Partner = {
  shot?: { src: string; alt: string; caption: string };
  id: string;
  logo: (typeof PARTNER_LOGOS)[number];
  role: string;
  scope: string;
  title: [string, string];
  lede: string;
  steps: { h: string; p: string }[];
  record: { label: string; rows: { k: string; v: string; tone?: 'ok' | 'wait' | 'stop' }[]; note: string };
  links: { label: string; href: string }[];
  limits: string;
};

const PARTNERS: Partner[] = [
  {
    id: 'intercepta',
    logo: PARTNER_LOGOS[0],
    role: 'Recipient screening',
    scope: 'Mainnet risk data · every payment',
    title: ['The cap limits how much.', 'Intercepta decides who.'],
    lede: 'A capped key can still pay a scammer. Before the agent’s session key signs anything, the Kagi MCP asks Intercepta about the recipient, and the verdict picks the rung of the ladder the payment goes to.',
    steps: [
      {
        h: 'Screen before the signature.',
        p: 'A quick scan of the recipient runs first. Anything flagged gets a deep toxic-score scan, and the traits come back as reasons a person can read.',
      },
      {
        h: 'Turn the verdict into a rung.',
        p: 'Clean addresses are paid within the cap. A score of 30 or more, or exposure such as phishing dust or mixer contact, is held for your phone and stick, even under the cap. Sanctioned, scam or blacklisted recipients are refused with no signature at all.',
      },
      {
        h: 'Fail towards a person.',
        p: 'If Intercepta can’t be reached, the payment is held, never passed. A held payment travels the contract’s existing request → raise path, so it still needs the phone and Kagi Wallet to sign.',
      },
    ],
    record: {
      label: 'Demo recipients · live verdicts',
      rows: [
        { k: '0xBB0D…DCe0 (gas sponsor wallet)', v: 'Pass · risk 0', tone: 'ok' },
        { k: '0x7aa2…f67E', v: 'Hold · risk 45, phishing transfer', tone: 'wait' },
        { k: '0x098B…2f96 (Tornado Cash)', v: 'Refuse · sanctioned', tone: 'stop' },
      ],
      note: 'Verdicts from Intercepta’s API at the time of writing, as listed in the README.',
    },
    links: [
      { label: 'Read the screening policy', href: src('agent-mcp/intercepta.mjs') },
      { label: 'See the check inside send_eth', href: src('agent-mcp/server.mjs') },
      { label: 'The held-payment screen in the app', href: src('mobile/src/app/limit/[id].tsx') },
    ],
    limits:
      'Intercepta’s data covers mainnet, so the recipient is screened as a mainnet address while the payment itself runs on a testnet. Screening happens in the MCP server; the contract enforces the cap, not the verdict.',
  },
  {
    id: 'curvegrid',
    logo: PARTNER_LOGOS[1],
    role: 'Event indexing · MultiBaas',
    scope: 'Testnet deployment · every wallet',
    title: ['The chain knows the balance.', 'MultiBaas knows the story.'],
    lede: 'The chain can say how much allowance is left, not why. Curvegrid’s MultiBaas indexes every event a Kagi wallet emits, so your AI can answer “what did my agent spend today, and who approved the raise?” from records instead of guesses.',
    steps: [
      {
        h: 'Link each wallet on first contact.',
        p: 'Every phone deploys its own wallet, so none can be linked ahead of time. The first time a wallet reaches the server, it registers the KagiAccount ABI once, gives the address an alias and links it with event indexing on.',
      },
      {
        h: 'One call instead of log scanning.',
        p: 'A single GET /events per wallet replaces eth_getLogs, which free public RPCs refuse without an address or cap at 50 blocks.',
      },
      {
        h: 'Turn events into sentences.',
        p: 'get_activity reads Spent, LimitRequested, LimitRaised, LimitDeclined, Granted and Revoked, and tells the AI what happened in order: payments, asks for more, and the owner’s answers.',
      },
      {
        h: 'Total it with Event Queries.',
        p: 'MultiBaas groups the spends by agent and by recipient and adds them up on its side. get_spending_summary gives the AI the numbers, and the app’s Spending screen shows the owner the same totals, with every approval and Intercepta hold.',
      },
    ],
    shot: { src: './app/spending.png', alt: 'The Spending screen in the Kagi app: agents spent 0.000002 ETH in 1 payment, limit raised from 0.000005 to 0.000007 ETH, top recipient, and approvals including one Intercepta hold.', caption: 'Home → Spending in the Kagi app, real testnet data' },
    record: {
      label: 'What get_activity reads',
      rows: [
        { k: 'Spent', v: 'every payment the agent made' },
        { k: 'LimitRequested', v: 'each ask for more, with its reason' },
        { k: 'LimitRaised / Declined', v: 'your answer, from phone + stick' },
        { k: 'Granted / Revoked', v: 'keys issued and stopped' },
      ],
      note: 'KagiAccount events as indexed by MultiBaas.',
    },
    links: [
      { label: 'Read the MultiBaas client', href: src('agent-mcp/multibaas.mjs') },
      { label: 'See get_activity', href: src('agent-mcp/server.mjs') },
      { label: 'See the Spending screen', href: src('mobile/src/app/spending.tsx') },
      { label: 'How Kagi uses MultiBaas', href: src('docs/curvegrid-multibaas.md') },
    ],
    limits:
      'The free plan indexes at most 100 blocks (about 20 minutes) into the past and links up to 10 wallets, so history starts just before a wallet’s first connection, and an event query returns at most 50 rows. The MultiBaas key stays on the agent server; the app asks it for its own wallet’s totals. MultiBaas is read-only here: it never signs or moves funds.',
  },
];

export function Partners() {
  return (
    <section className="section" id="partners">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">The integrations that make it work</span>
          <h2>Two integrations. One boundary.</h2>
          <p>
            Intercepta screens who an agent pays. Curvegrid’s MultiBaas remembers what it did. The contract and your stick
            enforce everything in between.
          </p>
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
              <header className="int-head">
                <a href={p.logo.href} target="_blank" rel="noreferrer">
                  <img src={p.logo.logo} alt={p.logo.name} width={p.logo.width} height={p.logo.height} />
                </a>
                <span className="int-tags">
                  <span>{p.role}</span>
                  <span>{p.scope}</span>
                </span>
              </header>

              <div className="int-body">
                <div className="int-copy">
                  <h3 id={`int-${p.id}`}>
                    {p.title[0]} <span>{p.title[1]}</span>
                  </h3>
                  <p className="int-lede">{p.lede}</p>
                  <ol className="int-steps">
                    {p.steps.map((s) => (
                      <li key={s.h}>
                        <b>{s.h}</b>
                        <span>{s.p}</span>
                      </li>
                    ))}
                  </ol>
                </div>

                <aside className="int-side">
                  {p.shot ? (
                    <figure className="int-shot">
                      <img src={p.shot.src} alt={p.shot.alt} width={540} height={1100} loading="lazy" />
                      <figcaption>{p.shot.caption}</figcaption>
                    </figure>
                  ) : null}
                  <div className="int-record">
                    <span className="int-label">{p.record.label}</span>
                    <dl>
                      {p.record.rows.map((r) => (
                        <div key={r.k} className={r.tone ? `tone-${r.tone}` : undefined}>
                          <dt>{r.k}</dt>
                          <dd>{r.v}</dd>
                        </div>
                      ))}
                    </dl>
                    <small>{p.record.note}</small>
                  </div>
                  <ul className="int-links">
                    {p.links.map((l) => (
                      <li key={l.href + l.label}>
                        <a href={l.href} target="_blank" rel="noreferrer">
                          {l.label} <span aria-hidden="true">↗</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                  <details className="int-limits">
                    <summary>Scope and limits</summary>
                    <p>{p.limits}</p>
                  </details>
                </aside>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
