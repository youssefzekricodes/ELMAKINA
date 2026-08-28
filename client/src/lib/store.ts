/* Tiny external store: the socket layer writes here, React reads it with useStore(). */
import { useSyncExternalStore } from 'react';
import type { ActionDef } from '../theme';

export interface Profile { avatar: string; avatarData: string | null; color: string | null }
export interface RoomPlayer { id: string; name: string; ready: boolean; connected: boolean; isHost: boolean; isBot?: boolean; avatar?: string; avatarData?: string | null; color?: string | null }
export interface Room { code: string; you: string; hostId: string; players: RoomPlayer[]; phase: string; minPlayers: number; maxPlayers: number; canStart: boolean }
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
  log: LogEntry[];
  events?: any[];
  serverTime: number;
}

export interface Snapshot {
  screen: 'home' | 'lobby' | 'game' | 'leaderboard' | 'friends';
  connected: boolean;
  net: 'ok' | 'slow' | 'off';   // connection quality shown in the top bar
  room: Room | null;
  state: GameState | null;
  me: string | null;
  lang: string;
  soundOn: boolean;
  profile: Profile;
  name: string;
  autoJoinCode: string | null;
  targeting: ActionDef | null;
  targetId: string | null;
  logOpen: boolean;
  logCollapsed: boolean;
  unread: number;
  banner: { text: string; id: number; cls?: string } | null;
  modal: 'rules' | 'avatar' | 'chars' | 'guide' | 'invite' | null;
  tour: boolean; // guided play-vs-bot: show coach-marks + character rule previews (one game, from the guide)
  learn: boolean; // persistent "learning mode": the same coaching in EVERY game until it's switched off
  reactions: FloatingReaction[]; // ephemeral in-game emoji reactions (broadcast, not persisted)
  account: Account | null;   // signed-in identity (Google) or guest
  trophies: number;          // my trophy total
  friends: Friend[];         // accepted friends
  friendReqs: Friend[];      // incoming pending requests
  invite: RoomInvite | null; // a friend invited me to their room (live push)
  tick: number; // bumps when language changes so every text re-renders
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
  profile: loadProfile(), name: localStorage.getItem('mekina.name') || '', autoJoinCode: null,
  targeting: null, targetId: null, logOpen: false, logCollapsed: false, unread: 0, banner: null, modal: null, tour: false, learn: loadLearn(), reactions: [],
  account: null, trophies: 0, friends: [], friendReqs: [], invite: null, tick: 0,
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

export const saveProfile = (p: Profile) => localStorage.setItem('mekina.profile', JSON.stringify(p));

/** Custom avatar data URLs received in room payloads (by player id). */
export const customAvatars: Record<string, string> = {};
export const avatarSrc = (p?: { id?: string; avatar?: string; avatarData?: string | null } | null) =>
  p && p.avatar === 'custom' ? (customAvatars[p.id || ''] || p.avatarData || '') : `/img/avatars/${(p && p.avatar) || 'boy-1'}.webp`;
