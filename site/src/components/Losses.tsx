import { losses } from '../data';

export function Losses() {
  const groups = [
    { kind: 'agent' as const, title: 'Agent access', description: 'When an agent can move more than it should.' },
    { kind: 'blind' as const, title: 'Signing blind', description: 'When the transaction differs from what the signer sees.' },
  ];
  return (
    <section className="section" id="incidents">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow section-index">01 / The problem</span>
          <h2>When access goes unchecked.</h2>
          <p>Selected losses from compromised agents and misleading signing flows. Every incident links to its reporting.</p>
        </div>
        <div className="incident-groups">
          {groups.map(g => (
            <div className="incident-group" key={g.kind}>
              <header className="incident-group-head"><h3>{g.title}</h3><p>{g.description}</p></header>
              <div className="incident-list">
                {losses.filter(l => l.kind === g.kind).map(l => (
                  <a className="incident" key={l.name} href={l.source} target="_blank" rel="noreferrer">
                    <div className="incident-byline"><span>{l.outlet}</span><time>{l.when}</time></div>
                    <h4>{l.name}</h4>
                    <p>{l.what}</p>
                    <div className="incident-card-foot"><div><span>Reported loss</span><strong>{l.label}</strong></div><span className="incident-read">Read report ↗</span></div>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
        <aside className="incident-takeaway">
          <span className="eyebrow">The boundary</span>
          <p>A key with a <strong>$500 allowance</strong> can spend up to $500. Raising that allowance needs your physical approval.</p>
          <a href="#how">How approval works ↗</a>
        </aside>
      </div>
    </section>
  );
}
