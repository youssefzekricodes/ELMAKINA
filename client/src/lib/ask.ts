/**
 * A confirmation the app draws itself, in place of window.confirm().
 *
 * window.confirm() is not ours. In a browser it is chrome-styled and carries the origin; inside the
 * Capacitor shell Android renders it as a system AlertDialog, in the platform's font and colours,
 * announcing the package name — an OS dialog interrupting a game that has spent a lot of effort
 * looking like nothing else. It also BLOCKS the main thread, which in a game with a turn clock
 * running is its own problem.
 *
 * The API stays promise-shaped so call sites read almost exactly as they did:
 *
 *   if (!(await ask(t('toast.leave')))) return;
 *
 * Dismissing — backdrop, Escape, the close button — resolves FALSE. For the two things this guards
 * (leaving a game in progress, removing another player) the safe answer to an ambiguous gesture is
 * always "no".
 */
import { store } from './store';
import { t } from '../i18n';

let pending: ((ok: boolean) => void) | null = null;

/** Ask the player to confirm. Resolves true only on an explicit yes. */
export function ask(body: string, opts?: { ok?: string; danger?: boolean }): Promise<boolean> {
  // A second question while one is open cancels the first rather than losing its promise for good.
  pending?.(false);
  return new Promise<boolean>((resolve) => {
    pending = resolve;
    store.set({ ask: { body, ok: opts?.ok || t('ask.ok'), danger: !!opts?.danger } });
  });
}

/** Called by the dialog. Clears the resolver BEFORE settling, so a handler that asks again works. */
export function answerAsk(ok: boolean) {
  const resolve = pending;
  pending = null;
  store.set({ ask: null });
  resolve?.(ok);
}
