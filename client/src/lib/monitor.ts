/**
 * Error monitoring (Sentry) — loaded late, and only if it is configured at all.
 *
 * Three rules this file exists to keep:
 *
 * 1. **It never delays the game.** Sentry is imported dynamically, after first paint, into its own
 *    chunk. With no DSN the chunk is never fetched and the app is byte-for-byte what it was.
 * 2. **Nothing is lost while it loads.** main.tsx starts collecting errors from the first line of
 *    script; whatever it caught before Sentry arrived is replayed into it afterwards.
 * 3. **No personal data leaves the app.** The player is identified by their account id and nothing
 *    else — no email, no display name, no avatar. An error report is for finding a bug, not for
 *    handing a third party a user list.
 */
import { BUILD_ID } from './update';

const DSN = (import.meta.env.VITE_SENTRY_DSN as string | undefined) || '';

type Sentry = typeof import('@sentry/react');
let sentry: Sentry | null = null;
let starting: Promise<Sentry | null> | null = null;
let pendingUser: string | null = null;

/** Errors that happened before (or without) Sentry — main.tsx fills this from the first byte. */
const buffered = (): unknown[] => ((window as unknown as { __mekinaErrors?: unknown[] }).__mekinaErrors) || [];

async function load(): Promise<Sentry | null> {
  if (sentry) return sentry;
  if (!DSN) return null;
  if (starting) return starting;
  starting = (async () => {
    try {
      const S = await import('@sentry/react');
      S.init({
        dsn: DSN,
        release: BUILD_ID,                         // the same id version.json reports, so a report names its build
        environment: import.meta.env.MODE,
        // A card game is not a checkout: a small trace sample is plenty to see which calls are slow,
        // and the quota is better spent on errors that actually happened.
        tracesSampleRate: 0.05,
        sendDefaultPii: false,
        ignoreErrors: [
          'ResizeObserver loop limit exceeded',      // browser noise, not ours
          'ResizeObserver loop completed with undelivered notifications',
          'AbortError',                              // a play() or fetch superseded by the next one
        ],
        beforeSend(event) {
          // Belt and braces: even if something upstream attaches a user, only the id survives.
          if (event.user) event.user = { id: event.user.id };
          return event;
        },
      });
      sentry = S;
      if (pendingUser) S.setUser({ id: pendingUser });
      // Replay whatever happened before we were here, so the first error of a session is not the
      // one error nobody ever sees.
      for (const e of buffered().splice(0)) S.captureException(e instanceof Error ? e : new Error(String(e)));
      return S;
    } catch { return null; }   // a blocked or failed CDN must never take the game with it
  })();
  return starting;
}

/** Call once, from the app's own start-up. Idles first: monitoring is not what anyone came for. */
export function initMonitor(): void {
  if (!DSN) return;
  const go = () => { load(); };
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(go, { timeout: 4000 }); else setTimeout(go, 2500);
}

/** Who this is, as an id and nothing else. Safe to call before Sentry has loaded. */
export function setMonitorUser(uid: string | null): void {
  pendingUser = uid;
  if (sentry) sentry.setUser(uid ? { id: uid } : null);
}

/** Report something we caught ourselves — a failed op, a broken payload, a dead code path. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!DSN) return;
  load().then((S) => {
    if (!S) return;
    S.withScope((scope) => {
      if (context) scope.setContext('mekina', context);
      S.captureException(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

/** A note in the trail that leads to the next error. Cheap; dropped entirely when unconfigured. */
export function trail(message: string, data?: Record<string, unknown>): void {
  if (!DSN || !sentry) return;
  sentry.addBreadcrumb({ category: 'mekina', message, data, level: 'info' });
}
