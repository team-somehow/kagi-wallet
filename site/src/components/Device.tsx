// The wrist ESP32 device. The screen is drawn in the firmware's own 240 x 135 px coordinates
// (firmware/wrist/src/main.cpp, the prompt layout), so it matches what the real device shows.
import type { CSSProperties, ReactNode } from 'react';

export type Screen =
  | { kind: 'prompt'; title: string; amount: string; line1: string; line2?: string; hold: number }
  | { kind: 'status'; top: string; big: string; sub: string; tone?: 'ok' | 'stop'; meter?: number }
  | { kind: 'logo' };

const C = { amber: '#ffb13b', text: '#ece9e1', muted: '#8e939b', faint: '#585d65', cell: '#2b2f36', red: '#ff5a4e' };
const F = 'Helvetica Neue, Helvetica, Arial, sans-serif';

function Lcd({ screen }: { screen: Screen }) {
  if (screen.kind === 'logo') {
    return (
      <>
        <circle cx="92" cy="68" r="14" fill="none" stroke={C.text} strokeWidth="5" />
        <path d="M106 68h44M136 68v14M148 68v10" fill="none" stroke={C.amber} strokeWidth="5" strokeLinecap="round" />
      </>
    );
  }
  if (screen.kind === 'status') {
    const tone = screen.tone === 'stop' ? C.red : screen.tone === 'ok' ? C.amber : C.muted;
    return (
      <>
        <text x="14" y="22" fill={tone} fontSize="12.5" fontFamily={F}>{screen.top}</text>
        <text x="14" y="58" fill={C.text} fontSize="25" fontWeight="700" fontFamily={F}>{screen.big}</text>
        <text x="14" y="82" fill={C.muted} fontSize="12" fontFamily={F}>{screen.sub}</text>
        {screen.meter !== undefined && (
          <>
            <rect x="14" y="102" width="212" height="8" rx="4" fill={C.cell} />
            <rect x="14" y="102" width={Math.max(4, 212 * Math.min(1, screen.meter))} height="8" rx="4" fill={screen.meter >= 0.8 ? C.amber : C.text} />
          </>
        )}
      </>
    );
  }
  const r = 12.5;
  const circ = 2 * Math.PI * r;
  return (
    <>
      <text x="14" y="23" fill={C.amber} fontSize="12.5" fontFamily={F}>{screen.title}</text>
      <text x="14" y="58" fill={C.text} fontSize="25" fontWeight="700" fontFamily={F}>{screen.amount}</text>
      <text x="14" y="80" fill={C.muted} fontSize="12" fontFamily={F}>{screen.line1}</text>
      {screen.line2 && <text x="14" y="96" fill={C.faint} fontSize="8.5" fontFamily={F}>{screen.line2}</text>}
      <text x="14" y="112" fill={C.faint} fontSize="8.5" fontFamily={F}>B: no</text>
      <text className="lcd-hold" x="186" y="112" fill={C.amber} fontSize="11" fontWeight="700" textAnchor="end" fontFamily={F}>Hold to approve</text>
      <circle cx="206" cy="108" r={r} fill="none" stroke={C.cell} strokeWidth="1.4" />
      <circle
        cx="206" cy="108" r={r} fill="none" stroke={C.amber} strokeWidth="3"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - screen.hold)}
        transform="rotate(-90 206 108)" strokeLinecap="round"
      />
      <text x="206" y="112" fill={C.amber} fontSize="11" fontWeight="700" textAnchor="middle" fontFamily={F}>A</text>
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
  variant?: 'blue' | 'red';
  style?: CSSProperties;
  button?: ReactNode;
}) {
  return (
    <div className={`device device-${variant} ${className}`} style={style}>
      <div className="device-face">
        <svg className="lcd" viewBox="0 0 240 135" role="img" aria-label={describe(screen)}>
          <rect width="240" height="135" fill="#000" />
          <Lcd screen={screen} />
        </svg>
        {button ?? <span className={`device-a ${pressed ? 'is-pressed' : ''}`} aria-hidden="true" />}
      </div>
    </div>
  );
}

function describe(s: Screen) {
  if (s.kind === 'prompt') return `${s.title}: ${s.amount}, ${s.line1}. Hold A to approve, B to decline.`;
  if (s.kind === 'status') return `${s.top}: ${s.big}. ${s.sub}`;
  return 'Kagi';
}
