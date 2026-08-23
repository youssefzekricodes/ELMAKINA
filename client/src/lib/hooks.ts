import { useEffect, useState } from 'react';
import { now } from './net';

/** Remaining ms until a server deadline, refreshed ~10×/s. */
export function useCountdown(deadline?: number | null) {
  const [rem, setRem] = useState(() => (deadline ? Math.max(0, deadline - now()) : 0));
  useEffect(() => {
    if (!deadline) return;
    const id = setInterval(() => setRem(Math.max(0, deadline - now())), 100);
    setRem(Math.max(0, deadline - now()));
    return () => clearInterval(id);
  }, [deadline]);
  return rem;
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q); const fn = () => setM(mq.matches);
    mq.addEventListener('change', fn); return () => mq.removeEventListener('change', fn);
  }, [q]);
  return m;
}
