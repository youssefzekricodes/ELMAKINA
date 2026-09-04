/**
 * The Android home-screen streak widget, from the JS side.
 *
 * The widget itself is native (android/.../StreakWidget.java): a launcher can only draw
 * RemoteViews, so no WebView code can ever render it. What JS does is feed it the number after
 * every change and, once, ask the launcher to pin it — Android 8+ shows the system "add to home
 * screen?" sheet for that, which is exactly the Duolingo move.
 *
 * Everything here is a no-op off Android or before the plugin exists, so the web build and iOS
 * lose nothing and crash nowhere.
 */
import { isNative } from './platform';
import { store } from './store';
import { t } from '../i18n';

const plugin = (): any => (globalThis as any).Capacitor?.Plugins?.StreakWidget ?? null;

/**
 * The line under the number.
 *
 * Chosen HERE, not in Java: the widget cannot read the app's language setting, and the app's
 * language is a store value rather than the device locale — a phone in French with the game in
 * Derja must get Derja on the home screen.
 *
 * Rotates by the day, not at random: a widget that says something different every time the app
 * touches it reads as broken, while one that changes each morning reads as alive. Played-today has
 * its own single line, because that state is a pat on the back and not a nudge.
 */
function nudge(count: number, today: boolean): string {
  if (count <= 0) return t('widget.start');
  if (today) return t('widget.today');
  const pool = ['widget.come', 'widget.while', 'widget.late', 'widget.waiting', 'widget.keep', 'widget.miss'];
  const day = Math.floor(Date.now() / 86_400_000);
  return t(pool[day % pool.length]);
}

export interface WidgetStreak { count: number; today: boolean; played: string[]; frozen: string[]; freezes: number; atRisk: boolean }

/**
 * Push the streak to the launcher. Along with the count go the DAYS played, not just "today":
 * the widget checks the device's own calendar, so the nudge under the number flips from "Lit
 * today" to the cold line the next morning without the app being opened — which is why two
 * labels travel with it. `mood` picks the banner: the frozen one whenever the streak is on ice or
 * one ad from being lost, the same rule the in-app card uses.
 */
export function updateStreakWidget(st: WidgetStreak) {
  if (!isNative()) return;
  plugin()?.update({
    count: st.count,
    label: nudge(st.count, st.today),
    labelCold: nudge(st.count, false),
    played: st.played.join(','),
    frozen: st.frozen.join(','),
    mood: st.atRisk || st.freezes > 0 ? 'freeze' : 'warm',
  }).catch(() => { /* widget missing is fine */ });
}

/** The system pin sheet, directly on Android; elsewhere just surface the in-app card. */
export async function promptPinWidget() {
  const p = plugin();
  if (!p) { store.set({ modal: 'streak' }); return; }
  try {
    const { value } = await p.canPin();
    if (value) await p.pin();
    else store.set({ modal: 'streak' });
  } catch { store.set({ modal: 'streak' }); }
}

/** Can the launcher pin, AND has the player not already done it? Both, because the button is an
 *  offer — and offering something already done reads as the app not knowing its own state. */
export const canPinWidget = async (): Promise<boolean> => {
  const p = plugin();
  if (!p) return false;
  try {
    const [can, already] = await Promise.all([p.canPin(), p.isPinned?.() ?? Promise.resolve({ value: false })]);
    return !!can.value && !already.value;
  } catch { return false; }
};

/** Whether one is on the home screen right now — the modal says so instead of offering the button. */
export const isWidgetPinned = async (): Promise<boolean> => {
  const p = plugin();
  if (!p?.isPinned) return false;
  try { return !!(await p.isPinned()).value; } catch { return false; }
};
