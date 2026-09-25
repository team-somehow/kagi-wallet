import { useEffect, useState } from 'react';

/** Re-render on an interval so countdowns stay honest. */
export function useNow(intervalMs = 10000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
