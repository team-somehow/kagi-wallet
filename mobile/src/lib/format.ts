export function usdc(n: number): string {
  const whole = Math.abs(n - Math.round(n)) < 0.005;
  const s = n.toLocaleString('en-US', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `$${s}`;
}

export function shortAddr(a: string, head = 6, tail = 4): string {
  if (a.length <= head + tail + 1) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

export function timeLeft(ms: number): string {
  if (ms <= 0) return 'expired';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m`;
  return 'under a minute';
}

export function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function hours(h: number): string {
  return h === 1 ? '1 hour' : `${h} hours`;
}

/** Break a 0x address into groups of 4 hex chars for display. */
export function groupAddr(a: string): string {
  const hex = a.startsWith('0x') ? a.slice(2) : a;
  return `0x ${hex.match(/.{1,4}/g)?.join(' ') ?? hex}`;
}
