/* Supabase transport: anonymous auth, one Edge Function (`game`) for every intent, Realtime (postgres_changes)
   for room + per-player view updates, and client-scheduled `tick`s so timeouts/bots advance exactly when due. */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { toast } from '@heroui/react';
import { supabase, supabaseConfigured } from './supabase';
import { store, customAvatars, type Profile, type Room } from './store';
import { i18n, t } from '../i18n';
import { sfx } from './sfx';
import { processEvents, resetEvents, banner } from './fx';
import { voiceOnRoomGone } from './voice';
import { initSocial, syncProfile } from './social';
import { validTargets } from './rules';
import { ACTIONS, type ActionDef } from '../theme';

let clockOffset = 0;
let turnSeen: number | null = null;
let channel: RealtimeChannel | null = null;
let channelCode: string | null = null;
let tickTimer: any = null, pollTimer: any = null, pingTimer: any = null;
let uid: string | null = null;
export const now = () => Date.now() + clockOffset;
export const myId = () => uid;

export function notify(msg: string, ok = false) { if (ok) toast.success(msg); else toast.danger(msg); }

/** Call the game Edge Function. Returns {ok, error?, ...}. */
export async function emit(op: string, data?: any): Promise<any> {
  sfx.play('click');
  if (!supabase) return { ok: false, error: 'offline' };
  try {
    const { data: res, error } = await supabase.functions.invoke('game', { body: { op, ...(data || {}) } });
    if (error) {
      // supabase-js wraps non-2xx; try to read the JSON body
      let msg = error.message || 'Server error';
      try { const ctx: any = (error as any).context; if (ctx && typeof ctx.json === 'function') { const j = await ctx.json(); if (j && j.error) msg = j.error; } } catch { /* ignore */ }
      notify(i18n.err(msg)); sfx.play('error');
      return { ok: false, error: msg };
    }
    if (res && res.ok === false) { notify(i18n.err(res.error || t('toast.error'))); sfx.play('error'); }
    return res || {};
  } catch (e: any) {
    notify(i18n.err(e?.message || t('toast.error'))); sfx.play('error');
    return { ok: false, error: e?.message };
  }
}

function roomFromLobby(l: any): Room | null {
  if (!l) return null;
  for (const p of l.players) if (p.avatar === 'custom' && p.avatarData) customAvatars[p.id] = p.avatarData;
  return { code: l.code, you: uid || '', hostId: l.hostId, players: l.players, phase: l.phase, minPlayers: l.minPlayers, maxPlayers: l.maxPlayers, canStart: l.canStart };
}

function applyRoom(l: any) {
  const room = roomFromLobby(l);
  if (!room) { unsubscribe(); voiceOnRoomGone(); store.set({ room: null, state: null, me: uid, screen: 'home', tour: false }); return; }
  store.set((s) => ({ room, me: uid, screen: room.phase === 'lobby' ? 'lobby' : (s.state ? 'game' : s.screen) }));
  if (room.phase === 'lobby') { resetEvents(); store.set({ state: null, targeting: null, targetId: null, screen: 'lobby' }); }
  subscribe(room.code);
}

let lastViewTime = 0;
function applyView(v: any) {
  if (!v) return;
  if (v.serverTime && v.serverTime < lastViewTime) return; // ignore a view older than one we already applied
  lastViewTime = v.serverTime || lastViewTime;
  clockOffset = v.serverTime - Date.now();
  const prev = store.get();
  const me = uid;
  const prevTurn = prev.state?.turnPlayerId, prevStage = prev.state?.pending?.stage;
  const keepTargeting = prev.targeting && v.pending && v.pending.stage === 'turn' && v.pending.actorId === me;
  store.set({ state: v, me, screen: 'game', targeting: keepTargeting ? prev.targeting : null, targetId: keepTargeting ? prev.targetId : null });
  processEvents(v, me);
  const myTurnNow = v.phase === 'playing' && v.pending && v.pending.stage === 'turn' && v.pending.actorId === me;
  if (myTurnNow && (prevTurn !== me || prevStage !== 'turn') && turnSeen !== v.pending.deadline) {
    turnSeen = v.pending.deadline; banner(t('banner.turn')); sfx.play('turn');
    try { navigator.vibrate && navigator.vibrate(40); } catch { /* ignore */ }
  }
  scheduleTick(v);
}

/** Ask the server to advance timers/bots right when the next thing is due (plus a slow safety poll). */
function scheduleTick(v: any) {
  clearTimeout(tickTimer); clearInterval(pollTimer);
  if (!v || v.phase !== 'playing') return;
  if (v.nextDue) {
    const wait = Math.max(80, v.nextDue - now() + 120);
    tickTimer = setTimeout(() => emitQuiet('tick'), wait);
  }
  pollTimer = setInterval(() => { if (!document.hidden) emitQuiet('tick'); }, 5000);
}
async function emitQuiet(op: string, data?: any) {
  if (!supabase) return;
  try { await supabase.functions.invoke('game', { body: { op, ...(data || {}) } }); } catch { /* ignore */ }
}

function subscribe(code: string) {
  if (!supabase || !uid) return;
  if (channel && channelCode === code) return;
  unsubscribe();
  channelCode = code;
  channel = supabase
    .channel('room-' + code)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, (payload: any) => {
      if (payload.eventType === 'DELETE') { unsubscribe(); store.set({ room: null, state: null, screen: 'home' }); notify(i18n.err('Room closed')); return; }
      const r = payload.new; if (!r) return;
      applyRoom(lobbyFromRow(r));
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_views', filter: `id=eq.${code}:${uid}` }, (payload: any) => {
      const r = payload.new; if (r && r.view) applyView(r.view);
    })
    .on('broadcast', { event: 'react' }, ({ payload }: any) => { if (payload && payload.uid !== uid) addReaction(payload); })
    .subscribe((status) => { store.set({ connected: status === 'SUBSCRIBED' }); if (status === 'SUBSCRIBED') hello(); });
  clearInterval(pingTimer);
  pingTimer = setInterval(() => { if (!document.hidden) emitQuiet('ping'); }, 20000);
}
function unsubscribe() {
  if (channel && supabase) supabase.removeChannel(channel);
  channel = null; channelCode = null;
  clearTimeout(tickTimer); clearInterval(pollTimer); clearInterval(pingTimer);
}
/** rooms row → lobby payload (same shape the function returns) */
function lobbyFromRow(r: any) {
  const players = (r.players || []).map((p: any) => ({ id: p.id, name: p.name, ready: !!p.ready, connected: !!p.connected, isHost: p.id === r.host_id, isBot: !!p.isBot, avatar: p.avatar, avatarData: p.avatar === 'custom' ? p.avatarData || null : null, color: p.color }));
  const canStart = r.phase === 'lobby' && players.length >= 2 && players.every((p: any) => p.ready || p.isHost) && players.filter((p: any) => p.connected).length >= 2;
  return { code: r.code, hostId: r.host_id, phase: r.phase, minPlayers: 2, maxPlayers: 6, players, canStart };
}

/** Fetch the current room + view (on load, reconnect, and after subscribing). */
async function hello() {
  const res = await emitRaw('hello');
  if (!res || !res.ok) return;
  if (!res.room) { unsubscribe(); store.set({ room: null, state: null, me: uid, screen: 'home' }); tryAutoJoin(); return; }
  applyRoom(res.room);
  if (res.view) applyView(res.view);
}
async function emitRaw(op: string, data?: any) {
  if (!supabase) return null;
  try { const { data: res } = await supabase.functions.invoke('game', { body: { op, ...(data || {}) } }); return res; } catch { return null; }
}

export async function connect() {
  if (!supabase) { store.set({ connected: false }); return; }
  let { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) { notify('Supabase: ' + error.message); return; }
    session = data.session;
  }
  uid = session?.user.id || null;
  store.set({ me: uid });
  supabase.auth.onAuthStateChange((_e, s) => { uid = s?.user.id || uid; });
  if (uid) initSocial(uid);
  await hello();
  if (!store.get().room) store.set({ connected: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && store.get().room) { emitQuiet('ping'); hello(); } });
}

// ── lobby / room ──
const profileOf = () => store.get().profile;
async function afterJoin(res: any) {
  if (!res.ok) return res;
  store.set({ autoJoinCode: null });
  applyRoom(res.room);
  if (res.view) applyView(res.view);
  return res;
}
export async function createRoom(name: string) { return afterJoin(await emit('create_room', { name, profile: profileOf() })); }
export async function joinRoom(name: string, code: string) { const r = await afterJoin(await emit('join_room', { name, code, profile: profileOf() })); if (r.ok) clearInviteParam(); return r; }
export async function playSolo(name: string, guided = false) { return afterJoin(await emit('solo', { name, bots: 3, guided, profile: profileOf() })); }
export async function leaveRoom() { await emit('leave_room'); unsubscribe(); resetEvents(); voiceOnRoomGone(); store.set({ room: null, state: null, screen: 'home', tour: false }); }
async function lobbyOp(op: string) { const r = await emit(op); if (r && r.room) applyRoom(r.room); return r; }
export const toggleReady = () => lobbyOp('toggle_ready');
export const startGame = () => emit('start_game');
export const addBot = () => lobbyOp('add_bot');
export const removeBot = () => lobbyOp('remove_bot');
export async function newGame() { const r = await emit('new_game'); if (!r.ok) emit('back_to_lobby'); return r; }
export function commitProfile(p: Profile) {
  store.set({ profile: p }); localStorage.setItem('mekina.profile', JSON.stringify(p));
  if (p.avatar === 'custom' && p.avatarData) customAvatars.me = p.avatarData;
  if (store.get().room) emit('set_profile', { profile: p });
  syncProfile(); // keep the persistent profile row (leaderboard/friends) in step with the avatar
}
export async function copyInvite(code: string) {
  const url = `${location.origin}${location.pathname}?room=${code}`;
  try { await navigator.clipboard.writeText(url); notify(t('lobby.copied'), true); } catch { notify(url, true); }
}

// ── emoji reactions (ephemeral, broadcast over the room channel — no DB) ──
let reactionSeq = 0;
function addReaction(r: { uid: string; name: string; emoji: string }) {
  const id = ++reactionSeq;
  store.set((s) => ({ reactions: [...s.reactions.slice(-14), { id, uid: r.uid, name: r.name, emoji: r.emoji }] }));
  setTimeout(() => store.set((s) => ({ reactions: s.reactions.filter((x) => x.id !== id) })), 4200);
}
export function sendReaction(emoji: string) {
  const st = store.get();
  const name = st.room?.players.find((p) => p.id === uid)?.name || st.name || '?';
  addReaction({ uid: uid || '', name, emoji });                       // show mine instantly
  try { channel?.send({ type: 'broadcast', event: 'react', payload: { uid, name, emoji } }); } catch { /* ignore */ }
}

// ── game ──
export function startAction(type: string) {
  const a = ACTIONS.find((x) => x.type === type) as ActionDef;
  if (!a.target) { sendAction({ type }); return; }
  // When there's only one possible target (e.g. 1-vs-1), skip the picker.
  const st = store.get().state;
  const targets = st ? validTargets(st, uid, a) : [];
  if (targets.length === 1) {
    // police (choose a slot) and colonel (choose a guess) still need a second step — preselect the player;
    // every other targeted action can be applied straight away.
    if (a.type === 'police' || a.type === 'colonel') { store.set({ targeting: a, targetId: targets[0] }); return; }
    sendAction({ type, targetId: targets[0] });
    return;
  }
  store.set({ targeting: a, targetId: null });
}
/** Emit a game move and apply the server's returned view immediately (snappy, no Realtime wait). */
async function move(op: string, data?: any) { const r = await emit(op, data); if (r && r.view) applyView(r.view); return r; }
export async function sendAction(payload: any) { store.set({ targeting: null, targetId: null }); return move('game_action', { action: payload }); }
export const cancelTargeting = () => store.set({ targeting: null, targetId: null });
export const pickTarget = (id: string) => store.set({ targetId: id });
export const challenge = () => move('game_challenge');
export const challengeTarget = (targetId: string) => move('game_challenge_target', { targetId });
export const pass = () => move('game_pass');
export const block = () => move('game_block');
export const decide = (d: any) => move('game_decision', { choice: d });

// ── invite link (?room=CODE) ──
export function clearInviteParam() { if (location.search) history.replaceState(null, '', location.pathname); store.set({ autoJoinCode: null }); }
export function tryAutoJoin() {
  const { autoJoinCode, name, room } = store.get();
  if (!autoJoinCode || !uid || room) return;
  if (name.trim()) joinRoom(name.trim(), autoJoinCode);
}

export function setLanguage(l: string) {
  i18n.set(l);
  document.documentElement.lang = l === 'tn' ? 'ar' : 'en';
  document.documentElement.dir = i18n.dir();
  store.set((s) => ({ lang: i18n.lang, tick: s.tick + 1 }));
}
export function toggleSound() { store.set({ soundOn: sfx.toggle() }); }
export const isConfigured = supabaseConfigured;
