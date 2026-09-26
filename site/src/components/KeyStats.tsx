import { motion, useReducedMotion } from 'motion/react';
import { keyStats } from '../data';

export function KeyStats() {
  const reduce = useReducedMotion();
  return (
    <section className="section" id="keys">
      <div className="wrap keys">
        <div className="section-head">
          <span className="eyebrow section-index">02 / The principle</span>
          <h2>A stolen key should not be enough.</h2>
          <p>Kagi splits signing authority across your phone and wallet.</p>
        </div>
        <div className="key-evidence panel">
          <div className="key-evidence-chart">
            <span className="eyebrow">Share of stolen crypto</span>
            {keyStats.map((s, index) => (
              <a className="key-evidence-row" key={s.who} href={s.source} target="_blank" rel="noreferrer" aria-label={`${s.pct}% ${s.what}. Source: ${s.who}`}>
                <div className="key-evidence-meta"><span>{index === 0 ? '2024 · Compromised private keys' : '2025 · Infrastructure attacks'}</span><strong>{s.pct}<small>%</small></strong></div>
                <div className="key-evidence-track" aria-hidden="true">
                  <motion.span initial={reduce ? false : { scaleX: 0 }} whileInView={{ scaleX: s.pct / 100 }} style={reduce ? { scaleX: s.pct / 100 } : undefined} viewport={{ once: true }} transition={{ duration: .8 }} />
                </div>
                <div className="key-evidence-source"><span>{s.who} ↗</span>{index === 1 && <span>Mostly keys and seeds</span>}</div>
              </a>
            ))}
            <p className="key-evidence-note">Different years and categories; shown separately, not as a trend.</p>
          </div>
          <div className="key-principle">
            <span className="eyebrow">The Kagi approach</span>
            <div className="key-parts" aria-hidden="true">
              <div><svg viewBox="0 0 64 64"><rect x="19" y="7" width="26" height="50" rx="5"/><path d="M28 49h8"/></svg><span>Phone</span></div>
              <span className="key-parts-plus">+</span>
              <div><svg viewBox="0 0 64 64"><rect x="5" y="18" width="54" height="28" rx="4"/><rect x="11" y="24" width="30" height="16" rx="1"/><circle cx="49" cy="32" r="4"/></svg><span>Kagi Wallet</span></div>
            </div>
            <h3>Two shares.<br />One signature.</h3>
            <p>Neither device can sign alone.</p>
            <a className="key-principle-link" href="#how">Explore the approval system <span>↗</span></a>
          </div>
        </div>
      </div>
    </section>
  );
}
