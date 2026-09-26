import { lazy, Suspense } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { DEVICE_URL, PRICES_URL, prices } from '../data';
import { Device } from './Device';

const WalletModel = lazy(() => import('./WalletModel'));

const MAX = 260;
const SPECS = [
  ['ESP32-S3', 'dual core, 240 MHz'],
  ['1.14" screen', 'shows every request decoded'],
  ['Infrared', 'between the two Kagi Wallets'],
  ['Motion sensor', 'wear detection'],
  ['20 g', '48 × 24 × 15 mm'],
] as const;

export function Hardware() {
  const reduce = useReducedMotion();
  return (
    <section className="section" id="hardware">
      <div className="wrap">
        <Suspense fallback={<div style={{ minHeight: "100vh" }}>Loading 3D wallet…</div>}><WalletModel /></Suspense>

        <div className="section-head">
          <span className="eyebrow section-index">05 / The hardware</span>
          <h2>Two Kagi Wallets for $43</h2>
          <p>Each Kagi Wallet is an off-the-shelf ESP32 at $21.50. Start with one. Add a second to the same wallet whenever you want a stronger boundary.</p>
        </div>

        <div className="hw">
          <div className="hw-visual panel">
            <div className="hw-pair">
              <div className="hw-unit">
                <Device screen={{ kind: 'home', line: '11 µETH left, 1 key' }} />
                <span className="hw-tag">$21.50</span>
                <small className="hw-role">Kagi Wallet · BLE to your phone</small>
              </div>
              <span className="hw-plus" aria-hidden="true">+</span>
              <div className="hw-unit">
                <Device variant="red" screen={{ kind: 'home', line: 'Signs by infrared' }} />
                <span className="hw-tag">$21.50</span>
                <small className="hw-role is-second">Second Kagi Wallet · infrared only</small>
              </div>
            </div>
            <ul className="hw-specs">
              {SPECS.map(([a, b]) => (
                <li key={a}><b>{a}</b><span>{b}</span></li>
              ))}
            </ul>
          </div>

          <figure className="hw-chart panel">
            <figcaption>Retail price, USD</figcaption>
            <div className="price-bars">
              {prices.map((p, i) => (
                <div className={`price-row ${p.ours ? 'is-ours' : ''}`} key={p.name}>
                  <span className="price-name"><b>{p.name}</b><small>{p.note}</small></span>
                  <span className="price-track">
                    <motion.span
                      className="price-bar"
                      initial={reduce ? false : { width: 0 }}
                      whileInView={{ width: `${(p.usd / MAX) * 100}%` }}
                      viewport={{ once: true, amount: 0.6 }}
                      transition={{ duration: 0.8, delay: i * 0.1, ease: [0.2, 0.7, 0.2, 1] }}
                      style={reduce ? { width: `${(p.usd / MAX) * 100}%` } : undefined}
                    />
                    <span className="price-val" style={{ left: `${(p.usd / MAX) * 100}%` }}>${p.usd}</span>
                  </span>
                </div>
              ))}
            </div>
            <div className="price-axis" aria-hidden="true">
              <span />
              <div>{[0, 50, 100, 150, 200, 250].map((v) => <span key={v} style={{ left: `${(v / MAX) * 100}%` }}>${v}</span>)}</div>
            </div>
            <p className="fine">
              Two Kagi Wallets cost less than one hardware wallet. Prices: <a href={DEVICE_URL} target="_blank" rel="noreferrer">device store</a>, <a href={PRICES_URL} target="_blank" rel="noreferrer">Coin Bureau, Jun 2026</a>. No secure element, so no device is ever trusted alone.
            </p>
          </figure>
        </div>
      </div>
    </section>
  );
}
