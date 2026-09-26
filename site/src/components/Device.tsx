// An ESP32 stick. The screen is drawn in the firmware's own 240 x 135 px coordinates and colours
// (firmware/wrist/src/main.cpp: drawSurface, drawHome, drawPrompt, the vault screen), so it matches
// what the real device shows. The wrist stick is blue, the second stick red.
import type { CSSProperties, ReactNode } from 'react';

export type Variant = 'blue' | 'red';
export type Screen =
  | { kind: 'prompt'; title: string; amount: string; line1: string; line2?: string; hold: number }
  | { kind: 'status'; top: string; big: string; sub: string; tone?: 'ok' | 'stop' }
  // The home screen (firmware 0.6.0): the 鍵 | Kagi Wallet lockup and one line of state.
  | { kind: 'home'; line: string; tone?: 'hot' | 'quiet' };

const THEME: Record<Variant, { top: string; bottom: string; edge: string; accent: string; panel: string; cell: string }> = {
  blue: { top: '#e2eaf2', bottom: '#ecf0f4', edge: '#b6cadc', accent: '#1c6296', panel: '#e4eef7', cell: '#ccdeee' },
  red: { top: '#efe2e6', bottom: '#ecf0f4', edge: '#dcb8c0', accent: '#aa3448', panel: '#f8e8eb', cell: '#ecced4' },
};
const C = { text: '#111820', muted: '#545e6c', faint: '#8c949e', red: '#c4302a', bg: '#ecf0f4' };
const F = 'Helvetica Neue, Helvetica, Arial, sans-serif';

function Lcd({ screen, v }: { screen: Screen; v: Variant }) {
  const t = THEME[v];
  if (screen.kind === 'home') {
    // The lockup image is the firmware's lockup.h at 3x, placed where drawLockupHome puts it.
    const tone = screen.tone === 'hot' ? t.accent : screen.tone === 'quiet' ? C.faint : C.muted;
    return (
      <>
        <image href="/lockup.png" x="18" y="30" width="204" height="64.7" />
        <text x="120" y="118" fill={tone} fontSize="13" textAnchor="middle" fontFamily={F}>{screen.line}</text>
      </>
    );
  }
  if (screen.kind === 'status') {
    const tone = screen.tone === 'stop' ? C.red : t.accent;
    return (
      <>
        <text x="12" y="23" fill={tone} fontSize="13" fontWeight="700" fontFamily={F}>{screen.top}</text>
        <text x="12" y="62" fill={C.text} fontSize="25" fontWeight="700" fontFamily={F}>{screen.big}</text>
        <text x="12" y="90" fill={C.muted} fontSize="13" fontFamily={F}>{screen.sub}</text>
      </>
    );
  }
  const r = 14;
  const circ = 2 * Math.PI * r;
  return (
    <>
      <rect x="6" y="7" width="232" height="127" rx="8" fill={C.bg} />
      <rect x="4" y="4" width="230" height="124" rx="8" fill={t.panel} />
      <rect x="4.5" y="4.5" width="231" height="126" rx="8" fill="none" stroke={t.accent} />
      <text x="14" y="25" fill={t.accent} fontSize="13" fontWeight="700" fontFamily={F}>{screen.title}</text>
      <text x="14" y="62" fill={C.text} fontSize="27" fontWeight="700" fontFamily={F}>{screen.amount}</text>
      <text x="14" y="84" fill={C.muted} fontSize="13" fontFamily={F}>{screen.line1}</text>
      {screen.line2 && <text x="14" y="98" fill={C.faint} fontSize="9" fontFamily={F}>{screen.line2}</text>}
      <text x="14" y="112" fill={C.faint} fontSize="9" fontFamily={F}>Tap: no</text>
      <text className="lcd-hold" x="186" y="113" fill={t.accent} fontSize="12" fontWeight="700" textAnchor="end" fontFamily={F}>Hold to approve</text>
      <circle cx="206" cy="108" r={r} fill="none" stroke={t.cell} strokeWidth="1.4" />
      <circle
        cx="206" cy="108" r={r} fill="none" stroke={t.accent} strokeWidth="4"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - screen.hold)}
        transform="rotate(-90 206 108)"
      />
      <text x="206" y="112.5" fill={t.accent} fontSize="12" fontWeight="700" textAnchor="middle" fontFamily={F}>A</text>
    </>
  );
}

export function Device({
  screen,
  pressed = false,
  className = '',
  variant = 'blue',
  style,
  button,
}: {
  screen: Screen;
  pressed?: boolean;
  className?: string;
  variant?: Variant;
  style?: CSSProperties;
  button?: ReactNode;
}) {
  const t = THEME[variant];
  const id = `lcd-${variant}`;
  return (
    <div className={`device device-${variant} ${className}`} style={style}>
      <div className="device-face">
        <svg className="lcd" viewBox="0 0 240 135" role="img" aria-label={describe(screen)}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={t.top} />
              <stop offset="1" stopColor={t.bottom} />
            </linearGradient>
          </defs>
          <rect width="240" height="135" fill={`url(#${id})`} />
          <rect x="1.5" y="1.5" width="237" height="132" rx="9" fill="none" stroke={t.edge} />
          <Lcd screen={screen} v={variant} />
        </svg>
        {button ?? <span className={`device-a ${pressed ? 'is-pressed' : ''}`} aria-hidden="true" />}
      </div>
    </div>
  );
}

function describe(s: Screen) {
  if (s.kind === 'prompt') return `${s.title}: ${s.amount}, ${s.line1}. Hold the button to approve, tap it to decline.`;
  if (s.kind === 'home') return `Kagi Wallet. ${s.line}`;
  return `${s.top}: ${s.big}. ${s.sub}`;
}
