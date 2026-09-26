import { motion, useInView, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Device, type Screen } from './Device';

type Phase = 'idle' | 'running' | 'blocked' | 'asking' | 'approved' | 'declined' | 'revoked';
type Tx = { what: string; amt: number; state: 'sent' | 'blocked' | 'approved' };

const PLAN = [
  { what: 'Search API credits', amt: 40 },
  { what: 'Scrape a dataset', amt: 120 },
  { what: 'One GPU hour', amt: 85 },
  { what: 'Translation API', amt: 60 },
  { what: 'Dataset license', amt: 280 },
];
const CAP = 500;
const RAISED = 750;
const SCALE = 800; // gauge full scale, in dollars
const HOLD_MS = 1200;

// ---- gauge geometry: a 240 degree arc, 0 at lower left, 1 at lower right ----
const CX = 150, CY = 150, R = 112;
const pt = (t: number, r = R) => {
  const a = ((150 + 240 * t) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)] as const;
};
const arc = (t0: number, t1: number, r = R) => {
  const [x0, y0] = pt(t0, r);
  const [x1, y1] = pt(t1, r);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${(t1 - t0) * 240 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

function Gauge({ spent, cap, ghost, phase }: { spent: number; cap: number; ghost: number; phase: Phase }) {
  const reduce = useReducedMotion();
  const t = (v: number) => Math.min(1, v / SCALE);
  const [mx0, my0] = pt(t(cap), R - 22);
  const [mx1, my1] = pt(t(cap), R + 16);
  const [lx, ly] = pt(t(cap), R + 34);
  const stop = phase === 'revoked';
  return (
    <svg className="gauge" viewBox="0 0 300 250" role="img" aria-label={`Spent $${spent} of a $${cap} cap`}>
      <defs>
        <linearGradient id="g-fill" x1="0" x2="1">
          <stop offset="0" stopColor="#8e939b" />
          <stop offset="1" stopColor="#ece9e1" />
        </linearGradient>
        <filter id="g-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <path d={arc(0, 1)} className="g-track" />
      {[0, 0.25, 0.5, 0.75, 1].map((k) => {
        const [a, b] = pt(k, R - 16);
        const [c, d] = pt(k, R - 10);
        return <line key={k} x1={a} y1={b} x2={c} y2={d} className="g-tick" />;
      })}
      {ghost > spent && (
        <path d={arc(t(spent), t(ghost))} className="g-ghost" />
      )}
      <path
        d={arc(0, Math.max(0.001, t(spent)))}
        className={`g-fill ${stop ? 'is-stop' : ''}`}
        stroke="url(#g-fill)"
        style={reduce ? undefined : { transition: 'd 0.6s cubic-bezier(0.2, 0.7, 0.2, 1)' }}
      />
      <motion.g initial={false} animate={{ opacity: 1 }}>
        <motion.line
          className="g-cap"
          initial={false}
          animate={{ x1: mx0, y1: my0, x2: mx1, y2: my1 }}
          transition={{ type: 'spring', stiffness: 90, damping: 14 }}
        />
        <motion.line
          className="g-cap-glow"
          filter="url(#g-glow)"
          initial={false}
          animate={{ x1: mx0, y1: my0, x2: mx1, y2: my1 }}
          transition={{ type: 'spring', stiffness: 90, damping: 14 }}
        />
        <motion.text
          className="g-cap-label"
          textAnchor="middle"
          initial={false}
          animate={{ x: lx, y: ly + 4 }}
          transition={{ type: 'spring', stiffness: 90, damping: 14 }}
        >
          cap ${cap}
        </motion.text>
      </motion.g>
      <text x={CX} y={CY - 6} textAnchor="middle" className={`g-big ${stop ? 'is-stop' : ''}`}>${spent}</text>
      <text x={CX} y={CY + 20} textAnchor="middle" className="g-small">spent by the agent</text>
    </svg>
  );
}

const LOG: Record<Phase, { text: string; tone: 'quiet' | 'stop' | 'human' | 'ok' }> = {
  idle: { text: 'waiting for the agent', tone: 'quiet' },
  running: { text: 'spend() ok, under the cap', tone: 'quiet' },
  blocked: { text: 'spend() reverted: over the cap', tone: 'stop' },
  asking: { text: 'agent asked for $750, waiting on your wrist', tone: 'human' },
  approved: { text: 'raiseLimit() confirmed, spend() ok', tone: 'ok' },
  declined: { text: 'declined, agent stays inside $500', tone: 'quiet' },
  revoked: { text: 'revoke() confirmed, key is dead', tone: 'stop' },
};

export function Demo() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [phase, setPhase] = useState<Phase>('idle');
  const [txs, setTxs] = useState<Tx[]>([]);
  const [cap, setCap] = useState(CAP);
  const [hold, setHold] = useState(0);
  const holdRaf = useRef(0);
  const holdStart = useRef(0);

  const spent = txs.filter((t) => t.state !== 'blocked').reduce((s, t) => s + t.amt, 0);
  const ghost = phase === 'blocked' || phase === 'asking' || phase === 'declined' ? spent + PLAN[4].amt : spent;

  const start = useCallback(() => {
    setTxs([]);
    setCap(CAP);
    setHold(0);
    setPhase('running');
  }, []);

  useEffect(() => {
    if (inView && phase === 'idle') start();
  }, [inView, phase, start]);

  // The agent works through its plan on its own.
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setTimeout(() => {
      const next = PLAN[txs.length];
      if (!next) return;
      if (spent + next.amt > cap) {
        setTxs((t) => [...t, { ...next, state: 'blocked' }]);
        setPhase('blocked');
      } else {
        setTxs((t) => [...t, { ...next, state: 'sent' }]);
      }
    }, txs.length === 0 ? 500 : 1000);
    return () => clearTimeout(id);
  }, [phase, txs.length, spent, cap]);

  useEffect(() => {
    if (phase !== 'blocked') return;
    const id = setTimeout(() => setPhase('asking'), 1100);
    return () => clearTimeout(id);
  }, [phase]);

  const approve = useCallback(() => {
    setCap(RAISED);
    setTxs((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, state: 'approved' } : x)));
    setPhase('approved');
  }, []);

  const beginHold = () => {
    if (phase !== 'asking') return;
    cancelAnimationFrame(holdRaf.current);
    holdStart.current = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - holdStart.current) / HOLD_MS);
      setHold(p);
      if (p >= 1) approve();
      else holdRaf.current = requestAnimationFrame(tick);
    };
    holdRaf.current = requestAnimationFrame(tick);
  };
  const endHold = () => {
    cancelAnimationFrame(holdRaf.current);
    setHold((h) => (h >= 1 ? h : 0));
  };
  const onKey = (e: KeyboardEvent<HTMLButtonElement>, down: boolean) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (down && !e.repeat) beginHold();
    if (!down) endHold();
  };
  useEffect(() => () => cancelAnimationFrame(holdRaf.current), []);

  const screen: Screen =
    phase === 'asking'
      ? { kind: 'prompt', title: "Raise research-bot's total", amount: `$${RAISED}`, line1: `was $${CAP}`, line2: 'same expiry, 42 min left', hold }
      : phase === 'blocked'
        ? { kind: 'status', top: 'research-bot', big: `$${spent + PLAN[4].amt} > $${cap}`, sub: 'blocked by the contract', tone: 'stop' }
        : phase === 'approved'
          ? { kind: 'status', top: 'Approved', big: `$${spent} / $${cap}`, sub: 'landed on-chain', tone: 'ok', meter: spent / cap }
          : phase === 'declined'
            ? { kind: 'status', top: 'Declined', big: `$${spent} / $${cap}`, sub: 'agent stays in budget', meter: spent / cap }
            : phase === 'revoked'
              ? { kind: 'status', top: 'Revoked', big: 'All keys', sub: "the agent can't spend", tone: 'stop' }
              : { kind: 'status', top: 'research-bot', big: `$${spent} / $${cap}`, sub: 'spending on its own', meter: spent / cap };

  const log = LOG[phase];
  const finished = phase === 'approved' || phase === 'declined' || phase === 'revoked';

  return (
    <section className="section" id="demo">
      <div className="wrap">
        <div className="section-head">
          <h2>Watch the limit</h2>
          <p>The agent spends alone until it hits the cap. Then it's your call.</p>
        </div>

        <div className="demo panel" ref={ref}>
          <div className="demo-feed" aria-live="polite">
            <div className="feed-head">
              <span className="agent-dot" data-phase={phase} />
              research-bot
              <span className="feed-key">session key, expires in 24 h</span>
            </div>
            <ul>
              {txs.map((t) => (
                <li key={t.what} className={`tx is-${t.state}`}>
                  <span className="tx-what">{t.what}</span>
                  <span className="tx-amt">${t.amt}</span>
                  <span className="tx-state">{t.state}</span>
                </li>
              ))}
              {txs.length === 0 && <li className="tx is-empty">The agent is starting its task</li>}
            </ul>
          </div>

          <div className="demo-gauge">
            <Gauge spent={spent} cap={cap} ghost={ghost} phase={phase} />
            <p className={`chain-log tone-${log.tone}`}>
              <span className="chain-dot" />
              {log.text}
            </p>
          </div>

          <div className="demo-device">
            <Device
              className={`demo-wrist ${phase === 'asking' ? 'is-buzzing' : ''}`}
              screen={screen}
              button={
                <button
                  type="button"
                  className={`device-a is-live ${hold > 0 && hold < 1 ? 'is-pressed' : ''} ${phase === 'asking' ? 'is-ready' : ''}`}
                  aria-label="Hold A to approve the higher limit"
                  disabled={phase !== 'asking'}
                  onPointerDown={beginHold}
                  onPointerUp={endHold}
                  onPointerLeave={endHold}
                  onPointerCancel={endHold}
                  onKeyDown={(e) => onKey(e, true)}
                  onKeyUp={(e) => onKey(e, false)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  A
                </button>
              }
            />
            <div className="demo-actions">
              {phase === 'asking' && (
                <>
                  <p className="hint">Press and hold A</p>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPhase('declined')}>Decline with B</button>
                </>
              )}
              {!finished && phase !== 'asking' && (
                <button type="button" className="btn btn-stop btn-sm" onClick={() => setPhase('revoked')}>Revoke every key</button>
              )}
              {finished && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={start}>Run it again</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
