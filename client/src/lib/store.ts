/* Tiny external store: the socket layer writes here, React reads it with useStore(). */
import { useSyncExternalStore } from 'react';
import multiavatar from '@multiavatar/multiavatar/esm';
import type { ActionDef } from '../theme';

export interface Profile { avatar: string; avatarData: string | null; color: string | null }
export interface RoomPlayer { id: string; name: string; ready: boolean; connected: boolean; isHost: boolean; isBot?: boolean; avatar?: string; avatarData?: string | null; color?: string | null }
export interface Room { code: string; you: string; hostId: string; players: RoomPlayer[]; phase: string; minPlayers: number; maxPlayers: number; canStart: boolean; isPublic?: boolean; reactionSecs?: number; minReactionSecs?: number; maxReactionSecs?: number }
export interface GPlayer { id: string; name: string; coins: number; cardCount: number; alive: boolean; connected: boolean; isBot?: boolean; avatar?: string; color?: string }
export interface LogEntry { id: number; t: number; kind: string; key?: string; params?: any; text?: string }
export interface GameState {
  phase: 'playing' | 'ended' | string;
  players: GPlayer[];
  you?: { cards: string[] } | null;
  turnPlayerId?: string | null;
  winnerId?: string | null;
  deckSize: number;
  maxCoins: number;
  timings: Record<string, number>;
  pending?: { stage: string; actorId: string; action?: any; deadline?: number; logStart?: number; window?: any } | null;
  /** Final places + trophy deltas, sent by the engine only once the game has ended. */
  standings?: { id: string; rank: number; delta: number; win: boolean; isBot: boolean }[] | null;
  log: LogEntry[];
  events?: any[];
  serverTime: number;
}

export interface Snapshot {
  screen: 'home' | 'lobby' | 'game' | 'leaderboard' | 'friends' | 'public' | 'profile';
  connected: boolean;
  net: 'ok' | 'slow' | 'off';   // connection quality shown in the top bar
  room: Room | null;
  state: GameState | null;
  me: string | null;
  lang: string;
  soundOn: boolean;
  musicOn: boolean;          // the lobby bed, muted on its own — see lib/music
  profile: Profile;
  name: string;
  autoJoinCode: string | null;
  targeting: ActionDef | null;
  targetId: string | null;
  logOpen: boolean;
  logCollapsed: boolean;
  unread: number;
  banner: { text: string; id: number; cls?: string } | null;
  cine: Cine | null;            // the full-screen cut-scene playing right now (attack / verdict), or null
  modal: 'rules' | 'avatar' | 'chars' | 'guide' | 'invite' | null;
  tour: boolean; // guided play-vs-bot: show coach-marks + character rule previews (one game, from the guide)
  learn: boolean; // persistent "learning mode": the same coaching in EVERY game until it's switched off
  reactions: FloatingReaction[]; // ephemeral in-game emoji reactions (broadcast, not persisted)
  account: Account | null;   // signed-in identity (Google) or guest
  trophies: number;          // my trophy total
  friends: Friend[];         // accepted friends
  friendReqs: Friend[];      // incoming pending requests
  invite: RoomInvite | null; // a friend invited me to their room (live push)
  searching: boolean;        // quick match is running / we are sitting in a public room waiting for company
  onboarding: boolean;       // full-screen first-run step: pick a face, type a name — no way around it
  updateReady: boolean;      // a newer build is live and this tab is stale (see lib/update.ts)
  pushOn: boolean;           // notifications are subscribed on THIS device (see lib/push.ts)
  tick: number; // bumps when language changes so every text re-renders
}

/**
 * A cut-scene: the full-screen retelling of one beat — who did what to whom and what it cost.
 * `actorId` is the aggressor or the accuser, `targetId` the other face on screen, `loserId`
 * whoever actually pays (on a wrong accusation that is the accuser, not the target).
 */
export interface Cine {
  id: number;
  kind: 'hit' | 'out' | 'caught' | 'missed';
  actorId: string | null;
  targetId: string;
  loserId: string | null;
  character?: string;  // the card that was claimed or guessed (verdict scenes)
  guess?: boolean;     // a Colonel naming a card, not a challenge — it is worded differently
  took?: string;       // the card actually taken, on the one path where the table already knows it
  reason?: string;     // the weapon: paidkill, terrorist, colonel_correct, …
  lost: number;        // cards the loser handed over during this beat
  out: boolean;        // …and whether it finished them
}

/** A live emoji reaction floating over the table; removed automatically after a few seconds. */
export interface FloatingReaction { id: number; uid: string; name: string; emoji: string }
export interface Account { uid: string; name: string; email: string | null; avatarUrl: string | null; isGuest: boolean }
export interface Friend { id: string; uid: string; name: string; avatar: string | null; avatarData: string | null; status: 'pending' | 'accepted'; incoming: boolean }
export interface RoomInvite { id: string; fromName: string; code: string }

/** Learning mode: an explicit choice wins; otherwise a player who has never seen the briefing is a
    newcomer and gets the help by default (a veteran who already dismissed it is left alone). */
const loadLearn = (): boolean => {
  try {
    const v = localStorage.getItem('mekina.learn');
    if (v === 'on') return true;
    if (v === 'off') return false;
    return localStorage.getItem('mekina.coachSeen') !== '1';
  } catch { return true; }
};

const loadProfile = (): Profile => { try { return Object.assign({ avatar: 'boy-1', avatarData: null, color: null }, JSON.parse(localStorage.getItem('mekina.profile') || '{}')); } catch { return { avatar: 'boy-1', avatarData: null, color: null }; } };

let snap: Snapshot = {
  screen: 'home', connected: false, net: (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'off' : 'ok', room: null, state: null, me: null,
  lang: localStorage.getItem('mekina.lang') || 'tn', soundOn: localStorage.getItem('mekina.sound') !== 'off',
  musicOn: localStorage.getItem('mekina.music') !== 'off',
  profile: loadProfile(), name: localStorage.getItem('mekina.name') || '', autoJoinCode: null,
  targeting: null, targetId: null, logOpen: false, logCollapsed: false, unread: 0, banner: null, cine: null, modal: null, tour: false, learn: loadLearn(), reactions: [],
  account: null, trophies: 0, friends: [], friendReqs: [], invite: null, searching: false,
  // No saved name = a brand-new player: the full-screen onboarding runs until a name exists.
  onboarding: !(localStorage.getItem('mekina.name') || '').trim(), updateReady: false, pushOn: false, tick: 0,
};
const listeners = new Set<() => void>();

export const store = {
  get: () => snap,
  set(partial: Partial<Snapshot> | ((s: Snapshot) => Partial<Snapshot>)) {
    const p = typeof partial === 'function' ? partial(snap) : partial;
    snap = { ...snap, ...p };
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

export function useStore(): Snapshot {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export const session = {
  load(): { code: string; playerId: string; token: string } | null { try { return JSON.parse(localStorage.getItem('mekina.session') || 'null'); } catch { return null; } },
  save(s: unknown) { localStorage.setItem('mekina.session', JSON.stringify(s)); },
  clear() { localStorage.removeItem('mekina.session'); },
};

/** Flip learning mode and remember it (used by the Home + Guide toggles). */
export const setLearn = (on: boolean) => { try { localStorage.setItem('mekina.learn', on ? 'on' : 'off'); } catch { /* ignore */ } store.set({ learn: on }); };
/** True whenever the client should coach: the guide's one-off practice tour OR persistent learning mode. */
export const isCoaching = (s: Snapshot) => !!(s.tour || s.learn);

/**
 * True when the game is waiting on THIS player — their turn, a reaction they are eligible for, or
 * a decision only they can answer. Every window runs on a server deadline, so anything covering
 * the board has to get out of the way when this flips: a tutorial that eats a reaction window
 * costs a real card.
 */
export function needsMe(s: Snapshot): boolean {
  const st = s.state; if (!st || st.phase !== 'playing') return false;
  const w = st.pending?.window;
  if (w && w.type === 'reaction') return !!(Array.isArray(w.eligible) && w.eligible.includes(s.me) && !(w.passed || []).includes(s.me));
  if (w && w.type === 'decision') return w.playerId === s.me;
  return st.turnPlayerId === s.me && st.pending?.stage === 'turn';
}

/**
 * True when something is on the table that players are meant to be looking at: a claim open for
 * reactions, or an action resolving. Deliberately NOT another player's plain turn — waiting for
 * somebody to move is the one moment a briefing can sit on screen without costing anything.
 */
export function tableBusy(s: Snapshot): boolean {
  const st = s.state; if (!st || st.phase !== 'playing') return false;
  return !!(st.pending?.window || st.pending?.stage === 'resolving');
}

export const saveProfile = (p: Profile) => localStorage.setItem('mekina.profile', JSON.stringify(p));

/** Custom avatar data URLs received in room payloads (by player id). */
export const customAvatars: Record<string, string> = {};
/** Built-in avatars resolved through the IndexedDB cache when it has them (see lib/assets). */
export const builtInAvatars: Record<string, string> = {};
/**
 * `mv:<seed>` avatars are Multiavatars (multiavatar.com): the seed IS the image, generated locally
 * as an SVG — nothing to download, nothing to cache in IndexedDB, and the same seed draws the same
 * face on every device. Bots ship with hand-picked seeds; players can pick their own.
 */
const mvCache: Record<string, string> = {};
export const mvAvatar = (seed: string) =>
  mvCache[seed] || (mvCache[seed] = 'data:image/svg+xml;utf8,' + encodeURIComponent(multiavatar(seed)));
export const avatarSrc = (p?: { id?: string; avatar?: string; avatarData?: string | null } | null) => {
  if (p && p.avatar === 'custom') return customAvatars[p.id || ''] || p.avatarData || '';
  const name = (p && p.avatar) || 'boy-1';
  if (name.startsWith('mv:')) return mvAvatar(name.slice(3));
  return builtInAvatars[name] || `/img/avatars/${name}.webp`;
};
