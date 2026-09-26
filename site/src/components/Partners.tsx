// The two services the agent MCP calls: Intercepta screens every recipient, Curvegrid MultiBaas
// indexes the wallet's history. Logos are their own artwork on a transparent ground.
const PARTNERS = [
  {
    name: 'Intercepta',
    logo: './partners/intercepta-dark.png',
    width: 147,
    height: 35,
    href: 'https://intercepta.io',
    role: 'Screens every recipient before the agent’s key signs. Clean addresses are paid, flagged ones wait for your stick, sanctioned ones are refused.',
  },
  {
    name: 'Curvegrid MultiBaas',
    logo: './partners/curvegrid-dark.png',
    width: 152,
    height: 35,
    href: 'https://www.curvegrid.com/multibaas',
    role: 'Indexes the wallet’s events, so your AI can answer what the agent spent, what it asked for, and who approved it.',
  },
];

export function Partners() {
  return (
    <section className="section" id="partners">
      <div className="wrap">
        <div className="section-head">
          <h2>Integrated with</h2>
          <p>The cap limits how much an agent can lose. These decide who it may pay, and remember what it did.</p>
        </div>
        <div className="partners">
          {PARTNERS.map((p) => (
            <a key={p.name} className="partner panel" href={p.href} target="_blank" rel="noreferrer">
              <img src={p.logo} alt={p.name} width={p.width} height={p.height} />
              <span>{p.role}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
