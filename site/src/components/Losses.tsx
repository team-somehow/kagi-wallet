import { motion, useReducedMotion } from 'motion/react';
import { losses } from '../data';

// Log scale from $100 to $3B: the losses span six orders of magnitude, and a $500 cap
// has to be visible at the left.
const LO = 2; // 10^2
const HI = Math.log10(3e9);
const pos = (usd: number) => ((Math.log10(usd) - LO) / (HI - LO)) * 100;
const TICKS = [
  [1e2, '$100'], [1e3, '$1K'], [1e4, '$10K'], [1e5, '$100K'], [1e6, '$1M'], [1e7, '$10M'], [1e8, '$100M'], [1e9, '$1B'],
] as const;
const CAP_USD = 500;

export function Losses() {
  const reduce = useReducedMotion();
  const groups = [
    { kind: 'agent' as const, title: 'Agents that could move too much' },
    { kind: 'blind' as const, title: 'Signers who saw the wrong transaction' },
  ];
  return (
    <section className="section" id="incidents">
      <div className="wrap">
        <div className="section-head">
          <h2>What unlimited authority costs</h2>
          <p>Real losses, on a log scale. Tap a bar for the story.</p>
        </div>

        <div className="losses panel">
          {groups.map((g) => (
            <div className="loss-group" key={g.kind}>
              <h3>{g.title}</h3>
              <div className="loss-rows">
                {g.kind === 'agent' && (
                  <div className="cap-layer" aria-hidden="true">
                    <div className="cap-line" style={{ left: `${pos(CAP_USD)}%` }}>
                      <span><b>$500 Kagi cap</b><i>: each of these stops here</i></span>
                    </div>
                  </div>
                )}
                {losses.filter((l) => l.kind === g.kind).map((l, i) => (
                  <a className="loss-row" key={l.name} href={l.source} target="_blank" rel="noreferrer">
                    <span className="loss-name">
                      <b>{l.name}</b>
                      <small>{l.when}</small>
                    </span>
                    <span className="loss-track">
                      <motion.span
                        className="loss-bar"
                        initial={reduce ? false : { width: 0 }}
                        whileInView={{ width: `${pos(l.usd)}%` }}
                        viewport={{ once: true, amount: 0.6 }}
                        transition={{ duration: 0.9, delay: i * 0.08, ease: [0.2, 0.7, 0.2, 1] }}
                        style={reduce ? { width: `${pos(l.usd)}%` } : undefined}
                      />
                      <span className="loss-val" style={{ left: `min(${pos(l.usd)}%, calc(100% - 5.5rem))` }}>{l.label}</span>
                    </span>
                    <span className="loss-what">{l.what} <em>{l.outlet}</em></span>
                  </a>
                ))}
              </div>
            </div>
          ))}
          <div className="loss-axis" aria-hidden="true">
            <span />
            <div>
              {TICKS.map(([v, t], i) => (
                <span key={t} className={i % 2 ? 'is-minor' : ''} style={{ left: `${pos(v)}%` }}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
