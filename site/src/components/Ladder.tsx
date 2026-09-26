import { motion } from 'motion/react';
import { useState } from 'react';

type Who = 'agent' | 'phone' | 'wrist' | 'vault';
const DEVICES: { id: Who; name: string }[] = [
  { id: 'agent', name: 'Agent' },
  { id: 'phone', name: 'Phone' },
  { id: 'wrist', name: 'Wrist' },
  { id: 'vault', name: 'Second stick' },
];
const TIERS: { title: string; you: string; signs: Who[]; tone: 'quiet' | 'human' | 'stop' }[] = [
  { title: 'Spend under the cap', you: 'Nothing', signs: ['agent'], tone: 'quiet' },
  { title: 'Issue a key, raise a limit', you: 'Unlock phone, then hold A', signs: ['phone', 'wrist'], tone: 'human' },
  { title: 'Approve after adding a stick', you: 'Unlock phone, hold A on both', signs: ['phone', 'wrist', 'vault'], tone: 'human' },
  { title: 'Stop an agent', you: 'Hold to revoke', signs: ['phone'], tone: 'stop' },
];

function Icon({ id }: { id: Who }) {
  switch (id) {
    case 'agent':
      return <svg viewBox="0 0 24 24"><rect x="5" y="7" width="14" height="11" rx="3" /><path d="M12 3v4M9 12h.01M15 12h.01M9.5 15h5" /></svg>;
    case 'phone':
      return <svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>;
    case 'wrist':
    case 'vault':
      // Both sticks are the same ESP32: screen on the left, round A button on the right.
      return <svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2.5" /><rect x="5.5" y="9.2" width="9" height="5.6" rx="1" /><circle cx="17.8" cy="12" r="1.6" /></svg>;
  }
}

// The line that joins the devices that sign together. Wrist to second stick is infrared, drawn dashed in blue.
function Links({ signs, tone }: { signs: Who[]; tone: string }) {
  const idx = signs.map((s) => DEVICES.findIndex((d) => d.id === s)).sort();
  if (idx.length < 2) return null;
  const at = (i: number) => `${12.5 + i * 25}%`;
  const radio = idx.filter((i) => i < 3);
  return (
    <>
      <motion.span
        className={`link tone-${tone}`}
        style={{ left: at(radio[0]), right: `calc(100% - ${at(radio[radio.length - 1])})` }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.5 }}
      />
      {idx.includes(3) && (
        <motion.span
          className="link is-ir"
          style={{ left: at(2), right: `calc(100% - ${at(3)})` }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
        />
      )}
    </>
  );
}

export function Ladder() {
  const [sel, setSel] = useState(1);
  const tier = TIERS[sel];
  return (
    <section className="section" id="how">
      <div className="wrap">
        <div className="section-head">
          <h2>Same wallet. More protection.</h2>
          <p>Pick a level to see who has to sign.</p>
        </div>

        <div className="ladder panel">
          <div className="ladder-tiers" role="tablist" aria-label="Permission levels">
            {TIERS.map((t, i) => (
              <button
                key={t.title}
                role="tab"
                aria-selected={sel === i}
                className={`tier tone-${t.tone} ${sel === i ? 'is-on' : ''}`}
                onClick={() => setSel(i)}
              >
                <span className="tier-n">{i + 1}</span>
                <span className="tier-title">{t.title}</span>
                <span className="tier-you">{t.you}</span>
              </button>
            ))}
          </div>

          <div className="ladder-map" role="tabpanel" aria-label={`${tier.title}: signed by ${tier.signs.join(', ')}`}>
            <div className="nodes">
              <Links signs={tier.signs} tone={tier.tone} key={sel} />
              {DEVICES.map((d) => {
                const on = tier.signs.includes(d.id);
                return (
                  <motion.div
                    key={d.id}
                    className={`node node-${d.id} ${on ? `is-on tone-${tier.tone}` : ''}`}
                    animate={{ scale: on ? 1 : 0.92, opacity: on ? 1 : 0.35 }}
                    transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  >
                    <Icon id={d.id} />
                    <span>{d.name}</span>
                  </motion.div>
                );
              })}
            </div>
            <p className="ladder-note">
              {tier.signs.includes('vault')
                ? 'After joining, grants and limit increases need all three devices. Stick-to-stick approvals use infrared.'
                : tier.signs.length > 1
                  ? 'One split key. Neither half can sign alone.'
                  : tier.signs[0] === 'agent'
                    ? 'The contract checks the cap and expiry. Nobody is bothered.'
                    : 'The phone can revoke alone. Access stops when the chain confirms.'}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
