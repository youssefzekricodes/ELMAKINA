/**
 * Daily play streaks — the habit loop, Duolingo-style.
 *
 * The DATA lives server-side (supabase/migrations/20260904000000_streaks.sql): count, best, one
 * freeze, and the player's last local day. This file is the choreography around it:
 *
 *   - on sign-in, PEEK: put the flame on the home screen, and notice the one rescueable state —
 *     a streak broken by exactly one missed day, which a rewarded ad can still freeze;
 *   - on every finished game, TICK: the server extends/holds/resets, and if the count grew, the
 *     full-screen celebration fires (store.streakCine) with the phone buzzing under it;
 *   - after every change, tell the Android home-screen widget, and — once, after the very first
 *     streak — ask the player to pin it. A streak on the launcher is the whole retention trick:
 *     Duolingo built an empire on that widget being seen at breakfast.
 *
 * Timezone note: streaks are a LOCAL-midnight idea, so every call carries the device's offset.
 * The server does the day arithmetic; lying about the offset moves midnight a few hours, never
 * resurrects a lost streak.
 */
import { supabase } from './supabase';
import { store } from './store';
import { track } from './analytics';
import { updateStreakWidget, promptPinWidget } from './widget';

export interface Streak {
  count: number; best: number; freezes: number; today: boolean; atRisk: boolean;
  /** The player's local day as the server saw it, and the recent days played / covered by a freeze. */
  day: string; played: string[]; frozen: string[];
}

const tz = () => -new Date().getTimezoneOffset();   // JS is minutes BEHIND UTC; the SQL adds minutes AHEAD

const KEY_PIN_ASKED = 'mekina.streak.pinAsked';
const asked = () => { try { return localStorage.getItem(KEY_PIN_ASKED) === '1'; } catch { return true; } };
const markAsked = () => { try { localStorage.setItem(KEY_PIN_ASKED, '1'); } catch { /* private mode */ } };

interface Days { day?: string; played?: string[]; frozen?: string[] }
/** YYYY-MM-DD in LOCAL time — the same day the server derives from the offset, never toISOString's UTC. */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function apply(count: number, best: number, freezes: number, today: boolean, atRisk: boolean, days: Days) {
  const played = days.played || [], frozen = days.frozen || [];
  store.set({ streak: { count, best, freezes, today, atRisk, day: days.day || isoDay(new Date()), played, frozen } });
  updateStreakWidget({ count, today, played, frozen, freezes, atRisk });
}

/** On sign-in: current standing, without writing anything. */
export async function initStreaks() {
  if (!supabase) return;
  try {
    const { data } = await supabase.rpc('streak_peek', { p_tz_offset_min: tz() });
    if (!data) return;
    apply(data.count || 0, data.best || 0, data.freezes || 0, !!data.today, !!data.at_risk, data);
    if (data.at_risk) track('streak_at_risk', { count: data.count });
  } catch { /* streaks are decoration on the game, never in its way */ }
}

/** On every finished game (solo included — a habit is a habit): extend or start the streak. */
export async function tickStreak() {
  if (!supabase) return;
  try {
    const prev = store.get().streak?.count ?? 0;
    const { data } = await supabase.rpc('streak_tick', { p_tz_offset_min: tz() });
    if (!data) return;
    apply(data.count, data.best, data.freezes, true, false, data);
    if (data.extended && data.count > prev) {
      // The celebration owns the whole screen — but not the same instant the game ends. The result
      // sheet and its reveal land first; the streak takes the screen once the player has seen who
      // won, then hands it back. Fired together, the two fought for the same second and the
      // winner's name was half-hidden under a flame.
      const cine = { count: data.count, froze: !!data.froze };
      setTimeout(() => store.set({ streakCine: cine }), 1800);
      track('streak_extend', { count: data.count, froze: !!data.froze });
      // The FIRST streak is the pin moment: the player just felt the thing the widget keeps alive.
      if (data.count === 1 && !asked()) { markAsked(); promptPinWidget(); }
    }
  } catch { /* ignore */ }
}

/** The rewarded save: grant the freeze that at_risk needs. Caller runs the ad FIRST. */
export async function saveStreak(): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data } = await supabase.rpc('streak_save', { p_tz_offset_min: tz() });
    if (data) {
      // Re-read rather than patch the store by hand: while at risk the peek reported the count as
      // 0, and only the server knows what the rescue restored it to. The peek also carries the
      // newly frozen day and refreshes the widget on the way.
      await initStreaks();
      track('streak_saved', {});
    }
    return !!data;
  } catch { return false; }
}

/** The rewarded trophy boost: double a win, +1 a zero, refund a -1. Caller runs the ad FIRST. */
export async function claimTrophyBoost(): Promise<number | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.rpc('claim_trophy_boost');
    if (!data?.ok) return null;
    store.set({ trophies: data.trophies });
    track('trophy_boost', { bonus: data.bonus });
    return data.bonus as number;
  } catch { return null; }
}
