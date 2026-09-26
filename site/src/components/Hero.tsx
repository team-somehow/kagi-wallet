import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useEffect, useState, type PointerEvent } from 'react';
import { Device } from './Device';
import { BuiltWith } from './Partners';

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
        <p className="eyebrow hero-eyebrow">A physical boundary for digital money</p>
        <h1>
          Give your agent a spending key.
          <span>Keep the wallet.</span>
        </h1>
        <p className="hero-sub">Capped, expiring keys for AI agents. Raising a limit takes your phone and a hold on your Kagi Wallet.</p>
        <div className="hero-cta">
          <a className="btn btn-primary" href="#demo">Try the demo</a>
          <a className="btn btn-ghost" href="#get">Get the app and firmware</a>
        </div>
        <dl className="hero-facts">
          <div><dt>$43</dt><dd>for two Kagi Wallets</dd></div>
          <div><dt>2 → 3</dt><dd>approval devices, one wallet</dd></div>
          <div><dt>1 phone</dt><dd>can revoke agent access</dd></div>
        </dl>
        <BuiltWith />
      </div>

      <div className="hero-stage" onPointerMove={onMove} onPointerLeave={() => { mx.set(0); my.set(0); }}>
        <div className="stage-glow" aria-hidden="true" />
        <div className="stage-orbit" aria-hidden="true" />
        <div className="stage-phone" aria-hidden="true"><i />Unlock phone, then hold the button</div>
        <motion.div className="stage-3d" style={{ rotateX: reduce ? 20 : rx, rotateY: reduce ? -16 : ry }}>
          <Device
            className="hero-second" variant="red"
            screen={{ kind: 'home', line: 'Signs by infrared' }}
          />
          <svg className="ir-beam" viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden="true">
            <path d="M70 116 C 40 80, 30 40, 60 4" />
          </svg>
          <Device
            className="hero-wrist"
            pressed={hold > 0 && hold < 1}
            screen={{
              kind: 'prompt',
              title: 'Raise Agent’s total',
              amount: '5 → 20 µETH',
              line1: 'spent 2 µETH, 8 µETH waiting',
              line2: 'same expiry, 42 min left',
              hold,
            }}
          />
        </motion.div>
        <p className="stage-cap" aria-hidden="true">ONE WALLET · PHONE + TWO KAGI WALLETS</p>
      </div>
    </header>
  );
}
