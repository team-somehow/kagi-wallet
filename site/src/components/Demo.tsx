import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BatteryFull,
  Check,
  Fingerprint,
  KeyRound,
  Pause,
  Plus,
  Radio,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import '@fontsource/manrope/400.css';
import '@fontsource/ibm-plex-mono/400.css';
import '../spatial-demo.css';

type Phase =
  | 'request'
  | 'unlocked'
  | 'ir-out'
  | 'second'
  | 'ir-back'
  | 'confirming'
  | 'done'
  | 'declined'
  | 'join'
  | 'joining'
  | 'joined';
const after: Partial<Record<Phase, Phase>> = {
  'ir-out': 'second',
  'ir-back': 'confirming',
  confirming: 'done',
  joining: 'joined',
};
const labels: Record<Phase, string> = {
  request: 'Unlock phone',
  unlocked: 'Hold A on your wrist',
  'ir-out': 'Sending by infrared',
  second: 'Hold A on second stick',
  'ir-back': 'Returning signature',
  confirming: 'Confirming on Sepolia',
  done: 'Add a second stick',
  declined: 'Try approving instead',
  join: 'Join second stick',
  joining: 'Joining devices',
  joined: 'Try the IR approval',
};
const notes: Record<Phase, string> = {
  request: 'Approvals happen on your stick.',
  unlocked: 'Release early to cancel the hold.',
  'ir-out': 'Speaker quiet while IR is receiving.',
  second: 'The second stick makes the final decision.',
  'ir-back': 'Your allowance has not changed yet.',
  confirming: 'Waiting for the transaction receipt.',
  done: 'Same account. Your agent continues.',
  declined: 'The waiting payment was not sent.',
  join: 'Simulated setup · your account stays the same.',
  joining: 'Sealed shares over BLE.',
  joined: 'Next transfer: 12 µETH to ABC.',
};

export function Demo() {
  const [act, setAct] = useState(1),
    [phase, setPhase] = useState<Phase>('request'),
    [sound, setSound] = useState(false),
    [hold, setHold] = useState(0);
  const frame = useRef(0),
    holding = useRef(false),
    audio = useRef<AudioContext | null>(null);
  const dual = act === 2,
    join = ['join', 'joining', 'joined'].includes(phase),
    done = phase === 'done',
    declined = phase === 'declined';
  const old = dual ? 20 : 5,
    cap = dual ? 44 : 20,
    spent = dual ? 10 : 2,
    payment = dual ? 12 : 8;
  const cancelHold = () => {
    cancelAnimationFrame(frame.current);
    holding.current = false;
    setHold(0);
  };
  const enter = (next: Phase) => {
    cancelHold();
    setPhase(next);
  };
  useEffect(() => {
    const next = after[phase];
    if (!next) return;
    const timer = window.setTimeout(() => setPhase(next), phase === 'confirming' ? 1700 : 1300);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (!sound) return;
    const notes =
      phase === 'done' || phase === 'joined'
        ? [523, 659, 784]
        : phase === 'unlocked' || phase === 'second'
          ? [440, 660]
          : [];
    if (!notes.length) return;
    try {
      const ctx = (audio.current ??= new AudioContext());
      void ctx.resume();
      notes.forEach((hz, i) => {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain(),
          t = ctx.currentTime + i * 0.11;
        osc.type = 'sine';
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.07, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.12);
      });
    } catch {
      /* Sound is optional. */
    }
  }, [phase, sound]);
  useEffect(() => {
    const stop = () => {
      cancelAnimationFrame(frame.current);
      holding.current = false;
      setHold(0);
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      stop();
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
      void audio.current?.close();
      audio.current = null;
    };
  }, []);
  const beginHold = () => {
    if (holding.current || !['unlocked', 'second'].includes(phase)) return;
    holding.current = true;
    const start = performance.now();
    const tick = (now: number) => {
      if (!holding.current) return;
      const progress = Math.min(1, (now - start) / 900);
      setHold(progress);
      if (progress === 1) enter(phase === 'second' ? 'ir-back' : dual ? 'ir-out' : 'confirming');
      else frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  };
  const next = () => {
    if (phase === 'request') enter('unlocked');
    else if (declined) enter('request');
    else if (done) {
      setAct(2);
      enter('join');
    } else if (phase === 'join') enter('joining');
    else if (phase === 'joined') enter('request');
  };
  const title = done ? (
    <>
      Your agent moves.
      <br />
      <em>You stay in control.</em>
    </>
  ) : declined ? (
    <>
      The boundary
      <br />
      <em>holds.</em>
    </>
  ) : join ? (
    <>
      One more stick.
      <br />
      <em>The same wallet.</em>
    </>
  ) : dual ? (
    <>
      A little light.
      <br />
      <em>A stronger boundary.</em>
    </>
  ) : (
    <>
      An agent asks.
      <br />
      <em>You decide.</em>
    </>
  );
  const wristOK = ['ir-out', 'second', 'ir-back', 'confirming', 'done', 'joined'].includes(phase),
    secondOK = ['ir-back', 'confirming', 'done', 'joined'].includes(phase),
    phoneOK = !['request', 'join', 'joining', 'declined'].includes(phase);
  const proof: [string, boolean][] = [
    ['Phone', phoneOK],
    ['Wrist', wristOK],
    ...(dual ? [['2nd stick', secondOK] as [string, boolean]] : []),
  ];
  const currentSpent = done ? spent + payment : spent;
  const route =
    phase === 'joining'
      ? 'BLE · SEALED SHARES'
      : phase === 'ir-out'
        ? 'IR → APPROVAL'
        : phase === 'ir-back'
          ? 'IR ← SIGNATURE'
          : null;
  function device(second: boolean) {
    const active = phase === (second ? 'second' : 'unlocked'),
      approved = second ? secondOK : wristOK;
    let top = second ? 'SECOND STICK' : 'LIMIT REQUEST',
      value = second ? 'IR IDLE' : `${old} → ${cap}`,
      detail = second ? 'Ready when you are' : 'µETH · unlock phone';
    if (active) {
      top = 'RAISE LIMIT?';
      value = `${old} → ${cap}`;
      detail = 'µETH · HOLD A';
    }
    if (join) {
      top = second ? 'SECOND STICK' : 'WRIST';
      value = phase === 'joined' ? '3 OF 3' : second ? 'HELLO' : '2 OF 2';
      detail = 'Same wallet. Same address.';
    }
    if (phase === 'ir-out' || phase === 'ir-back') {
      top = 'INFRARED';
      value = phase === 'ir-out' ? (second ? 'READING' : 'SENDING') : second ? 'SIGNED' : 'READING';
      detail = route!;
    }
    if (phase === 'second' && !second) {
      top = 'WRIST';
      value = 'WAITING';
      detail = 'Second stick approval';
    }
    if (phase === 'confirming') {
      top = 'SIGNED';
      value = 'PENDING';
      detail = 'Awaiting chain receipt';
    }
    if (done) {
      top = second ? 'SECOND STICK' : 'ALLOWANCE';
      value = second ? 'APPROVED' : `${cap - spent - payment} µETH`;
      detail = second ? 'Back to IR idle' : 'Left for your agent';
    }
    if (declined) {
      top = 'BOUNDARY';
      value = 'HELD';
      detail = 'Payment not sent';
    }
    return (
      <div
        className={`kg-device ${second ? 'kg-second' : 'kg-first'}`}
        style={{ '--kg-hold': `${active ? hold * 100 : 0}%` } as CSSProperties}
        aria-hidden={second && !dual}
      >
        <div className="kg-port" />
        <div className="kg-case">
          <div className="kg-lcd">
            <div className="kg-lcd-top">
              <span>{top}</span>
              <span>{approved ? '✓' : '●'}</span>
            </div>
            <div className="kg-lcd-value">{value}</div>
            <div className="kg-lcd-line">{detail}</div>
          </div>
          <button
            className="kg-physical"
            aria-label={`Hold A on ${second ? 'second' : 'wrist'} stick to approve`}
            disabled={!active}
            data-held={active && hold > 0}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              beginHold();
            }}
            onPointerUp={cancelHold}
            onPointerCancel={cancelHold}
            onLostPointerCapture={cancelHold}
            onBlur={cancelHold}
            onKeyDown={(e) => {
              if ([' ', 'Enter'].includes(e.key)) {
                e.preventDefault();
                if (!e.repeat) beginHold();
              }
            }}
            onKeyUp={(e) => {
              if ([' ', 'Enter'].includes(e.key)) {
                e.preventDefault();
                cancelHold();
              }
            }}
            onContextMenu={(e) => e.preventDefault()}
          >
            <span className="kg-target" />
          </button>
        </div>
        <div className="kg-device-caption">{second ? '02 / SECOND STICK' : '01 / YOUR WRIST'}</div>
      </div>
    );
  }
  return (
    <section className="section" id="demo">
      <div className="wrap">
        <div id="kagi-studio" data-dual={dual} data-phase={phase}>
          <div className="kg-shell">
            <header className="kg-top">
              <div className="kg-brand">
                <KeyRound />
                kagi
              </div>
              <span className="kg-proto">
                A little trust.
                <br />A physical boundary.
              </span>
              <div className="kg-top-right">
                <span className="kg-network">
                  <span className="kg-dot" />
                  INTERACTIVE DEMO
                </span>
                <button
                  className="kg-sound"
                  aria-label={sound ? 'Mute sounds' : 'Enable sounds'}
                  aria-pressed={sound}
                  onClick={() => {
                    setSound(!sound);
                    if (sound) void audio.current?.suspend();
                  }}
                >
                  {sound ? <Volume2 /> : <VolumeX />}
                </button>
              </div>
            </header>
            <nav className="kg-tabs" aria-label="Demo act">
              {[1, 2].map((n) => (
                <button
                  key={n}
                  aria-pressed={act === n}
                  onClick={() => {
                    setAct(n);
                    enter(n === 1 ? 'request' : 'join');
                  }}
                >
                  <b>0{n}</b>
                  {n === 1 ? 'Phone + one stick' : 'Add a second stick'}
                </button>
              ))}
            </nav>
            <div className="kg-main">
              <section className="kg-left" aria-label="Approval devices">
                <div className="kg-eyebrow">
                  <span className="kg-dot" />
                  {join ? 'THREE DEVICES · ONE ACCOUNT' : 'YOU SET THE BOUNDARY'}
                </div>
                <h2 className="kg-title">{title}</h2>
                <p className="kg-lead">
                  {join
                    ? 'Extend the same wallet with a second physical approval. Future approvals travel by infrared.'
                    : 'A temporary key lets your agent transfer test ETH. More access needs your physical approval.'}
                </p>
                <div className="kg-stage">
                  <div className="kg-floor" />
                  <div className="kg-orbit" />
                  {route && (
                    <div id="kg-routes">
                      <svg
                        viewBox="0 0 560 337"
                        className="kg-beam"
                        style={{ width: '100%', height: '100%', position: 'absolute' }}
                      >
                        <path
                          d="M 235 210 Q 270 130 345 130"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeDasharray="6 8"
                          style={{
                            animation: 'kg-dash 4s linear infinite',
                            animationDirection: phase === 'ir-back' ? 'reverse' : 'normal',
                            color: '#83d6eb',
                          }}
                        />
                      </svg>
                      <span className="kg-beam-label">{route}</span>
                    </div>
                  )}
                  {device(false)}
                  {device(true)}
                </div>
                <div className="kg-action-hint">
                  <ArrowUpRight />
                  <span>
                    {phase === 'unlocked' || phase === 'second'
                      ? 'Press and hold the round button · 0.9 s'
                      : notes[phase]}
                  </span>
                </div>
                <div className="kg-hold-cue">
                  {['unlocked', 'second'].includes(phase) && (
                    <>
                      <button className="kg-decline" onClick={() => enter('declined')}>
                        B · Decline request
                      </button>
                      <button className="kg-decline" onClick={beginHold}>
                        Preview the hold
                      </button>
                    </>
                  )}
                </div>
              </section>
              <section className="kg-phone-wrap" aria-label="Kagi phone interface">
                <div className="kg-phone">
                  <div className="kg-phone-inner">
                    <div className="kg-island" />
                    <div className="kg-phone-top">
                      <span>9:41</span>
                      <BatteryFull />
                    </div>
                    <div className="kg-phone-heading">
                      <span>
                        {join
                          ? 'Protection'
                          : done
                            ? 'Transfer confirmed'
                            : declined
                              ? 'Request declined'
                              : 'Limit request'}
                      </span>
                      <ShieldCheck />
                    </div>
                    <div className="kg-agent-mark">
                      <div className="kg-agent-avatar">
                        <Sparkles />
                      </div>
                      <div className="kg-agent-meta">
                        <span>Agent</span>
                        <small>Temporary spending key</small>
                      </div>
                    </div>
                    <div className="kg-amount-label">
                      {join
                        ? 'Approval devices'
                        : done
                          ? 'Allowance remaining'
                          : declined
                            ? 'Total allowance unchanged'
                            : 'Increase total allowance'}
                    </div>
                    <div className="kg-amount">
                      {join ? (
                        <>
                          <span className="kg-old">2</span>
                          <ArrowRight />
                          <span>3</span>
                        </>
                      ) : done ? (
                        <span>{cap - currentSpent}</span>
                      ) : declined ? (
                        <span>{old}</span>
                      ) : (
                        <>
                          <span className="kg-old">{old}</span>
                          <ArrowRight />
                          <span>{cap}</span>
                        </>
                      )}
                    </div>
                    <div className="kg-unit">
                      {join
                        ? 'SAME WALLET · SAME ADDRESS'
                        : `µETH · ${(done ? cap - currentSpent : declined ? old : cap) / 1e6} ETH`}
                    </div>
                    {!join && (
                      <div className="kg-meter" aria-label={`${currentSpent} microETH spent`}>
                        {Array.from({ length: 20 }, (_, i) => (
                          <span
                            key={i}
                            className={i < Math.round((currentSpent / (done ? cap : old)) * 20) ? 'kg-used' : ''}
                          />
                        ))}
                      </div>
                    )}
                    {join ? (
                      <>
                        <Row label="Phone" value="Connected" />
                        <Row label="Wrist stick" value="Connected" />
                        <Row
                          label="Second stick"
                          value={phase === 'joined' ? 'Joined' : phase === 'joining' ? 'Joining…' : 'Ready to join'}
                        />
                      </>
                    ) : (
                      <>
                        <Row
                          label={done ? 'Sent to ABC' : declined ? 'Cancelled transfer' : 'Waiting transfer'}
                          value={`${payment} µETH`}
                        />
                        <Row label="Already spent" value={`${currentSpent} µETH`} />
                        <Row label="Expires in" value="58 min · unchanged" />
                      </>
                    )}
                    <div className="kg-proof">
                      {proof.map(([name, ok]) => (
                        <span key={name} className={ok ? 'kg-complete' : ''}>
                          <i>{ok ? '✓' : '·'}</i>
                          {name}
                        </span>
                      ))}
                    </div>
                    <div className="kg-phone-foot">
                      <button
                        className="kg-cta"
                        onClick={next}
                        disabled={!['request', 'declined', 'join', 'joined', ...(dual ? [] : ['done'])].includes(phase)}
                      >
                        {phase === 'request' ? <Fingerprint /> : join ? <Plus /> : done ? <Check /> : <Radio />}
                        {done && dual ? 'Both sticks approved' : labels[phase]}
                      </button>
                      <div className="kg-phone-note">{notes[phase]}</div>
                    </div>
                    <div className="kg-homebar" />
                  </div>
                </div>
              </section>
            </div>
            <section className="kg-agent-feed" aria-label="Agent MCP activity">
              <div className="kg-agent-feed-label">
                <Sparkles />
                <span>Agent + MCP</span>
              </div>
              <div className="kg-chat">
                <div className="kg-chat-request">
                  {join
                    ? 'Your wallet stays connected to your agent.'
                    : dual
                      ? 'You: “Send 0.000012 ETH to ABC.”'
                      : 'You: “Send 0.000002 ETH, then 0.000008 ETH to ABC.”'}
                </div>
                <div className="kg-chat-answer" aria-live="polite">
                  {done ? <Check /> : <Pause />}
                  <span>
                    {join
                      ? 'Same account and session key. Under-limit transfers remain automatic.'
                      : done
                        ? `${payment} µETH sent to ABC. ${cap - currentSpent} µETH remains in my allowance.`
                        : declined
                          ? 'You declined. I did not send the payment or change the allowance.'
                          : phase === 'confirming'
                            ? 'Waiting for confirmation before retrying the transfer.'
                            : `Only ${old - spent} µETH remains; I need ${payment}. I requested ${cap} µETH total and paused the payment.`}
                  </span>
                </div>
              </div>
            </section>
            <footer className="kg-bottom">
              <span>SIMULATION · NO REAL TRANSACTIONS</span>
              <span>{dual ? 'PHONE + TWO STICKS / 3 OF 3' : 'PHONE + WRIST / 2 OF 2'}</span>
            </footer>
          </div>
        </div>
      </div>
    </section>
  );
}
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="kg-info-row">
      <span>{label}</span>
      <span className="kg-mono">{value}</span>
    </div>
  );
}
