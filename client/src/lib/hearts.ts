/**
 * Hearts — three games a day, and a rewarded video refills them.
 *
 * The DATA lives server-side (supabase/migrations/20260921000000_hearts.sql): how many are left
 * today, by the player's own local day. This file is the choreography around it:
 *
 *   - on sign-in, PEEK, so the home screen shows the row of hearts;
 *   - at every way INTO a game (quick match, create, join, solo, play again) the gate asks
 *     `haveHeart()`: with none left it opens the hearts card instead of the game;
 *   - when a game actually STARTS, one heart is spent — not when a room is opened, so a lobby
 *     nobody joined costs nothing. A reload mid-game must not charge twice, hence the paid mark;
 *   - the refill runs the rewarded ad FIRST and only then asks the server for a full set.
 *
 * Unknown is not empty: until the server has answered (offline, signed out, migration not pushed
 * yet) `hearts` stays null and the gate lets the player through. Hearts meter the game; they must
 * never be the reason a working game refuses to start.
 *
 * The guided practice game is free — it is the tutorial, and charging for the lesson would spend
 * a new player's first heart before they have played anything.
 */
import { supabase } from './supabase';
import { store } from './store';
import { track } from './analytics';
import { rewardedAd } from './ads';

const tz = () => -new Date().getTimezoneOffset();
const KEY_PAID = 'mekina.heart.paid';   // the room code of the game this device already paid for

const put = (left: number, max: number) => store.set({ hearts: { left, max } });

export async function initHearts() {
  if (!supabase) return;
  try {
    const { data } = await supabase.rpc('hearts_peek', { p_tz_offset_min: tz() });
    if (data && typeof data.left === 'number') put(data.left, data.max || 3);
  } catch { /* unknown stays unknown: the gate lets the player through */ }
}

/** The gate. False means "no hearts": the card has been opened and the caller should stop. */
export function haveHeart(): boolean {
  const h = store.get().hearts;
  if (!h || h.left > 0) return true;
  store.set({ modal: 'hearts' });
  track('hearts_empty', {});
  return false;
}

/** A game just started in room `code`: spend one heart, once per game per device. */
export async function spendHeart(code: string) {
  if (!supabase || !code) return;
  try { if (localStorage.getItem(KEY_PAID) === code) return; localStorage.setItem(KEY_PAID, code); } catch { /* private mode: charge, never double-check */ }
  try {
    const { data } = await supabase.rpc('hearts_spend', { p_tz_offset_min: tz() });
    if (data && typeof data.left === 'number') put(data.left, data.max || 3);
  } catch { /* ignore */ }
}
/** The game is over (or left): the next start in this room is a new game and pays again. */
export function clearPaid() { try { localStorage.removeItem(KEY_PAID); } catch { /* ignore */ } }

/** Watch a video, get a full set. Walking out of the video grants nothing. */
export async function refillHearts(): Promise<boolean> {
  if (!supabase) return false;
  const r = await rewardedAd();
  // 'unavailable' must not punish the player for our ad problem — same rule as the streak save.
  if (r === 'dismissed') return false;
  try {
    const { data } = await supabase.rpc('hearts_refill', { p_tz_offset_min: tz() });
    if (data && typeof data.left === 'number') { put(data.left, data.max || 3); track('hearts_refill', {}); return true; }
  } catch { /* ignore */ }
  return false;
}
