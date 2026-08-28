/* Supabase transport: anonymous auth, one Edge Function (`game`) for every intent, Realtime (postgres_changes)
   for room + per-player view updates, and client-scheduled `tick`s so timeouts/bots advance exactly when due. */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { toast } from '@heroui/react';
import { supabase, supabaseConfigured } from './supabase';
import { store, customAvatars, type Profile, type Room } from './store';
import { i18n, t } from '../i18n';
import { sfx } from './sfx';
import { processEvents, resetEvents, banner, playedCard } from './fx';
import { voiceOnRoomGone } from './voice';
import { initSocial, syncProfile } from './social';
import { validTargets } from './rules';
import { ACTIONS, type ActionDef } from '../theme';

let clockOffset = 0;
let turnSeen: number | null = null;
let actionSeen = '';
let claimSeen: number | null = null; // dedupes the "X claims Y" banner per reaction window (avoids reconnect spam)
let channel: RealtimeChannel | null = null;
let channelCode: string | null = null;
let tickTimer: any = null, pollTimer: any = null, pingTimer: any = null;
let uid: string | null = null;
export const now = () => Date.now() + clockOffset;
export const myId = () => uid;

/** Connection quality: browser offline events, request latency and the realtime channel all feed this. */
const SLOW_MS = 2500;
export function setNet(v: 'ok' | 'slow' | 'off') { if (store.get().net !== v) store.set({ net: v }); }
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => setNet('off'));
  window.addEventListener('online', () => setNet('ok'));
}

export function notify(msg: string, ok = false) { if (ok) toast.success(msg); else toast.danger(msg); }

/** Call the game Edge Function. Returns {ok, error?, ...}. */
export async function emit(op: string, data?: any): Promise<any> {
  sfx.play('click');
  if (!supabase) return { ok: false, error: 'offline' };
  const t0 = Date.now();
  try {
    const { data: res, error } = await supabase.functions.invoke('game', { body: { op, ...(data || {}) } });
    setNet(navigator.onLine === false ? 'off' : Date.now() - t0 > SLOW_MS ? 'slow' : 'ok');
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
    setNet('off');
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
  if (room) exiting = false;
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
  // Flash the played card for EVERY action — including the basic ones (income / loan / paid kill),
  // which have no character claim and were previously invisible.
  const pa = v.pending && v.pending.action;
  if (pa && prev.state) {
    const sig = `${v.pending.logStart}:${pa.actorId}:${pa.type}`;
    if (actionSeen !== sig) {
      actionSeen = sig;
      if (pa.actorId !== me) playedCard(pa.type);
    }
  } else if (!pa) actionSeen = '';
  // Announce a fresh claim / counter with the big table banner (skip my own claim, skip replays on (re)join).
  const rw = v.phase === 'playing' && v.pending && v.pending.window && v.pending.window.type === 'reaction' ? v.pending.window : null;
  if (rw && rw.claim && claimSeen !== rw.deadline) {
    const hadState = !!prev.state;
    claimSeen = rw.deadline;
    if (hadState && rw.claim.claimerId !== me) {
      const nm = (v.players.find((p: any) => p.id === rw.claim.claimerId) || {}).name || '?';
      const act = v.pending.action;
      // a Colonel claim announces the actual guess, so nobody misses what was called
      if (rw.claim.character === 'colonel' && act && act.guess) {
        const tn2 = (v.players.find((p: any) => p.id === act.targetId) || {}).name || '?';
        banner(t('banner.colonelClaim', { name: nm, character: i18n.charName(act.guess), target: tn2 }), 'sm');
      } else banner(t(rw.claim.kind === 'action' ? 'banner.claim' : 'banner.counter', { name: nm, character: i18n.charName(rw.claim.character) }), 'sm');
    }
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
  const t0 = Date.now();
  try {
    await supabase.functions.invoke('game', { body: { op, ...(data || {}) } });
    setNet(navigator.onLine === false ? 'off' : Date.now() - t0 > SLOW_MS ? 'slow' : 'ok');
  } catch { setNet('off'); }
}

let exiting = false; // I'm deliberately leaving/closing — ignore the room-row echo of my own exit
/** Tear everything down and land on the home screen (shared by leave / kick / close / room-deleted). */
function exitToHome(msg?: string) {
  unsubscribe(); resetEvents(); voiceOnRoomGone();
  store.set({ room: null, state: null, screen: 'home', tour: false });
  if (msg) notify(msg);
}

function subscribe(code: string) {
  if (!supabase || !uid) return;
  if (channel && channelCode === code) return;
  unsubscribe();
  channelCode = code;
  channel = supabase
    .channel('room-' + code)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` }, (payload: any) => {
      if (exiting) return;
      if (payload.eventType === 'DELETE') { exitToHome(i18n.err('Room closed')); return; }
      const r = payload.new; if (!r) return;
      const l = lobbyFromRow(r);
      // I was kicked (or my seat vanished) — the row still exists, I'm just not on it any more.
      if (uid && store.get().room && !l.players.some((p: any) => p.id === uid)) { exitToHome(t('toast.kicked')); return; }
      applyRoom(l);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_views', filter: `id=eq.${code}:${uid}` }, (payload: any) => {
      const r = payload.new; if (r && r.view) applyView(r.view);
    })
    .on('broadcast', { event: 'react' }, ({ payload }: any) => { if (payload && payload.uid !== uid) addReaction(payload); })
    .subscribe((status) => { const up = status === 'SUBSCRIBED'; store.set({ connected: up }); if (up) { setNet(navigator.onLine === false ? 'off' : 'ok'); hello(); } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setNet('off'); });
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
export async function leaveRoom() { exiting = true; await emit('leave_room'); exitToHome(); }
/** Host closes the room for everyone; the others get the rooms-row DELETE over Realtime. */
export async function closeRoom() { exiting = true; const r = await emit('close_room'); if (r && r.ok) exitToHome(); else exiting = false; return r; }
async function lobbyOp(op: string, data?: any) { const r = await emit(op, data); if (r && r.room) applyRoom(r.room); return r; }
export const toggleReady = () => lobbyOp('toggle_ready');
export const startGame = () => emit('start_game');
export const addBot = () => lobbyOp('add_bot');
export const removeBot = () => lobbyOp('remove_bot');
/** Host removes somebody from the lobby (works on bots too). */
export const kickPlayer = (targetId: string) => lobbyOp('kick', { targetId });
export async function newGame() { const r = await emit('new_game'); if (!r.ok) emit('back_to_lobby'); return r; }
/** Save my look (and optionally rename myself). In a room the server also gets the new name and
    hands back a fresh lobby view, so every other seat re-labels straight away. */
export function commitProfile(p: Profile, name?: string) {
  store.set({ profile: p }); localStorage.setItem('mekina.profile', JSON.stringify(p));
  if (p.avatar === 'custom' && p.avatarData) customAvatars.me = p.avatarData;
  const nm = name === undefined ? '' : name.trim().replace(/\s+/g, ' ').slice(0, 16);
  if (nm) { store.set({ name: nm }); localStorage.setItem('mekina.name', nm); }
  if (store.get().room) lobbyOp('set_profile', { profile: p, ...(nm ? { name: nm } : {}) });
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
  // When there's only one possible opponent (e.g. 1-vs-1), skip the player picker.
  // Note: police's target list includes yourself, so count OPPONENTS, not raw targets.
  const st = store.get().state;
  const targets = st ? validTargets(st, uid, a) : [];
  if (!targets.length) { notify(i18n.err(t('game.noTarget'))); return; } // guard: never arm an empty picker
  const others = targets.filter((id) => id !== uid);
  if (others.length === 1) {
    // police (choose a slot) and colonel (choose a guess) still need their follow-up — preselect the player;
    // every other targeted action applies straight away.
    if (a.type === 'police' || a.type === 'colonel') { store.set({ targeting: a, targetId: others[0] }); return; }
    sendAction({ type, targetId: others[0] });
    return;
  }
  store.set({ targeting: a, targetId: null });
}
/** Emit a game move and apply the server's returned view immediately (snappy, no Realtime wait). */
async function move(op: string, data?: any) { const r = await emit(op, data); if (r && r.view) applyView(r.view); return r; }
export async function sendAction(payload: any) { store.set({ targeting: null, targetId: null }); return move('game_action', { action: payload }); }
export const cancelTargeting = () => store.set({ targeting: null, targetId: null });
export const pickTarget = (id: string) => store.set({ targetId: id });
/** Tap a target while aiming — shared by the table seats AND the prompt's chip picker.
    Police goes player → slot, colonel goes player → guess; everything else fires immediately. */
export function tapTarget(pid: string, slot?: number) {
  const s = store.get(); const st = s.state;
  if (!st || !s.targeting || !validTargets(st, s.me, s.targeting).includes(pid)) return;
  if (s.targeting.type === 'police') {
    if (s.targetId === pid && slot !== undefined) { sendAction({ type: 'police', targetId: pid, slot }); return; }
    pickTarget(pid); return;
  }
  if (s.targeting.type === 'colonel') { pickTarget(pid); return; }
  sendAction({ type: s.targeting.type, targetId: pid });
}
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
  let n = name.trim();
  if (!n) { // invite links join directly — hand first-timers a guest name they can change later
    n = 'Guest' + Math.floor(100 + Math.random() * 900);
    store.set({ name: n }); localStorage.setItem('mekina.name', n);
  }
  joinRoom(n, autoJoinCode);
}

export function setLanguage(l: string) {
  i18n.set(l);
  document.documentElement.lang = l === 'tn' ? 'ar' : 'en';
  document.documentElement.dir = i18n.dir();
  store.set((s) => ({ lang: i18n.lang, tick: s.tick + 1 }));
}
export function toggleSound() { store.set({ soundOn: sfx.toggle() }); }
export const isConfigured = supabaseConfigured;
