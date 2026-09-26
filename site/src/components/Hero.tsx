import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useState, type PointerEvent } from 'react';
import { Device } from './Device';

export function Hero() {
  const reduce = useReducedMotion();
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rx = useSpring(useTransform(my, [-1, 1], [26, 12]), { stiffness: 120, damping: 18 });
  const ry = useSpring(useTransform(mx, [-1, 1], [-24, -8]), { stiffness: 120, damping: 18 });

  // The ring on the prompt fills and resets, like a finger holding A.
  const [hold, setHold] = useState(0.35);
  useEffect(() => {
    if (reduce) return;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const p = ((t - start) % 3600) / 3600;
      setHold(p < 0.15 ? 0 : p > 0.8 ? 1 : (p - 0.15) / 0.65);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduce]);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce) return;
    const r = e.currentTarget.getBoundingClientRect();
    mx.set(((e.clientX - r.left) / r.width) * 2 - 1);
    my.set(((e.clientY - r.top) / r.height) * 2 - 1);
  };

  return (
    <header className="hero" id="top">
      <div className="hero-copy">
        <h1>
          Give your agent a spending key.
          <span>Keep the wallet.</span>
        </h1>
        <p className="hero-sub">Capped, expiring keys for AI agents. Raising a limit takes your phone and a press on your wrist.</p>
        <div className="hero-cta">
          <a className="btn btn-primary" href="#demo">Try the demo</a>
          <a className="btn btn-ghost" href="#get">Get the app and firmware</a>
        </div>
        <dl className="hero-facts">
          <div><dt>$43</dt><dd>hardware for both signers</dd></div>
          <div><dt>0</dt><dd>devices that can sign alone</dd></div>
          <div><dt>1 tap</dt><dd>stops every agent</dd></div>
        </dl>
      </div>

      <div className="hero-stage" onPointerMove={onMove} onPointerLeave={() => { mx.set(0); my.set(0); }}>
        <div className="stage-glow" aria-hidden="true" />
        <div className="stage-floor" aria-hidden="true" />
        <motion.div className="stage-3d" style={{ rotateX: reduce ? 20 : rx, rotateY: reduce ? -16 : ry }}>
          <Device
            className="hero-vault"
            screen={{ kind: 'status', top: 'VAULT', big: 'Asleep', sub: 'no radio, infrared only' }}
          />
          <svg className="ir-beam" viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden="true">
            <path d="M40 118 C 55 80, 45 40, 62 2" />
          </svg>
          <Device
            className="hero-wrist"
            pressed={hold > 0 && hold < 1}
            screen={{
              kind: 'prompt',
              title: "Raise research-bot's total",
              amount: '$750',
              line1: 'was $500',
              line2: 'same expiry, 42 min left',
              hold,
            }}
          />
        </motion.div>
      </div>
    </header>
  );
}
