import { motion, useReducedMotion } from 'motion/react';
import { keyStats } from '../data';

function Ring({ pct }: { pct: number }) {
  const reduce = useReducedMotion();
  const r = 70;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 180 180" aria-hidden="true">
      <circle cx="90" cy="90" r={r} className="ring-track" />
      <motion.circle
        cx="90" cy="90" r={r}
        className="ring-fill"
        strokeDasharray={c}
        initial={reduce ? false : { strokeDashoffset: c }}
        whileInView={{ strokeDashoffset: c * (1 - pct / 100) }}
        viewport={{ once: true, amount: 0.6 }}
        transition={{ duration: 1.4, ease: [0.2, 0.7, 0.2, 1] }}
        style={reduce ? { strokeDashoffset: c * (1 - pct / 100) } : undefined}
        transform="rotate(-90 90 90)"
      />
      <text x="90" y="100" textAnchor="middle" className="ring-num">{pct}%</text>
    </svg>
  );
}

export function KeyStats() {
  return (
    <section className="section" id="keys">
      <div className="wrap keys">
        <div className="section-head">
          <h2>Most theft is a stolen key</h2>
          <p>So no single device, server or phone holds one.</p>
        </div>
        <div className="key-rings">
          {keyStats.map((s) => (
            <a className="key-ring" key={s.who} href={s.source} target="_blank" rel="noreferrer">
              <Ring pct={s.pct} />
              <p>{s.what}</p>
              <small>{s.who}</small>
            </a>
          ))}
          <div className="key-split" aria-label="Kagi splits each key across devices">
            <svg viewBox="0 0 180 180" aria-hidden="true">
              <circle cx="90" cy="90" r="70" className="ring-track" />
              <path d="M90 20 A70 70 0 0 1 90 160" className="split-a" />
              <path d="M90 160 A70 70 0 0 1 90 20" className="split-b" />
              <text x="90" y="86" textAnchor="middle" className="split-t">phone</text>
              <text x="90" y="106" textAnchor="middle" className="split-t is-blue">+ Kagi Wallet</text>
            </svg>
            <p>Kagi splits every key. Each half is useless alone.</p>
            <small>FROST, RFC 9591 · add a second Kagi Wallet for 3 of 3</small>
          </div>
        </div>
      </div>
    </section>
  );
}
