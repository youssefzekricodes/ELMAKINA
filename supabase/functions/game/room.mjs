/**
 * Rooms, lobby and game operations — the whole "server" as a pure function over a DB adapter.
 *
 *   handleOp({ db, uid, body, now }) -> { ok:true, ... } | { ok:false, error }
 *
 * The Supabase Edge Function (game/index.ts) plugs in a Postgres adapter; tests plug in an in-memory one.
 * Hidden game state is stored as JSON (game_state) and only ever read here; clients get per-player views.
 *
 * DB adapter (all async):
 *   getRoom(code) | insertRoom(row) | updateRoom(code, patch, expectedVersion) -> bool | deleteRoom(code)
 *   getMembership(uid) -> {code} | null   | addMember(code, uid, now) | removeMember(code, uid) | touchMember(code, uid, now)
 *   listMembers(code) -> [{user_id,last_seen}] | getState(code) -> {state, version} | null
 *   saveState(code, state, expectedVersion) -> bool (insert when expectedVersion===0) | deleteState(code)
 *   upsertViews(rows:[{id, code, user_id, view}]) | deleteViews(code) | listDueRooms(now) -> [code]
 */
import { Game, GameError, MIN_PLAYERS, MAX_PLAYERS } from './engine.mjs';
import { BOT_NAMES, runBots, botsNextDue } from './bots.mjs';

export const DEFAULT_AVATARS = ['boy-1', 'boy-2', 'boy-3', 'boy-4', 'boy-5', 'boy-6', 'girl-1', 'girl-2', 'girl-3', 'girl-4', 'girl-5', 'girl-6'];
export const PALETTE = ['#2f7d32', '#d7a800', '#1e4fb5', '#b3261e', '#4b6b2b', '#5b2d9e', '#b5561a'];
const MAX_AVATAR_DATA = 120000;
export const PRESENCE_MS = 45000; // a member is "connected" if seen within this
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 16) || 'Player';
export function cleanProfile(raw) {
  const out = { avatar: null, avatarData: null, color: null };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.avatar === 'custom' && typeof raw.avatarData === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.avatarData) && raw.avatarData.length <= MAX_AVATAR_DATA) { out.avatar = 'custom'; out.avatarData = raw.avatarData; }
  else if (DEFAULT_AVATARS.includes(raw.avatar)) out.avatar = raw.avatar;
  if (typeof raw.color === 'string' && PALETTE.includes(raw.color.toLowerCase())) out.color = raw.color.toLowerCase();
  return out;
}
export function genCode(rand = Math.random) { let code = ''; for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]; return code; }
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

function applyDefaults(players, player) {
  if (!player.avatar) { const used = new Set(players.filter((p) => p !== player).map((p) => p.avatar)); player.avatar = DEFAULT_AVATARS.find((a) => !used.has(a)) || DEFAULT_AVATARS[players.indexOf(player) % DEFAULT_AVATARS.length]; }
  if (!player.color) { const used = new Set(players.filter((p) => p !== player).map((p) => p.color)); player.color = PALETTE.find((c) => !used.has(c)) || PALETTE[players.indexOf(player) % PALETTE.length]; }
}
const humans = (room) => room.players.filter((p) => !p.isBot);

/** Final trophy deltas for the human players of a finished game.
 *  Rank 1 (winner) = +3, rank 2 = +1, last place = -1, everyone in between = 0.
 *  Ranking: winner first, then survivors/eliminated by reverse elimination order (last out ranks higher). */
function standings(game) {
  const players = game.players || [];
  const total = players.length;
  const out = game.outOrder || [];
  // rank order (best → worst): winner, then anyone still standing, then eliminated newest→oldest
  const ranked = [];
  if (game.winnerId) ranked.push(game.winnerId);
  for (const p of players) if (p.alive && p.id !== game.winnerId && !ranked.includes(p.id)) ranked.push(p.id);
  for (let i = out.length - 1; i >= 0; i--) if (!ranked.includes(out[i])) ranked.push(out[i]);
  for (const p of players) if (!ranked.includes(p.id)) ranked.push(p.id); // safety net
  const delta = (rank) => (rank === 1 ? 3 : rank === total ? -1 : rank === 2 ? 1 : 0);
  return ranked
    .map((id, i) => ({ id, rank: i + 1 }))
    .filter(({ id }) => { const p = players.find((x) => x.id === id); return p && !p.isBot; })
    .map(({ id, rank }) => ({ id, delta: delta(rank), win: rank === 1 }));
}
const pickHost = (room) => { if (!room.players.find((p) => p.id === room.host_id) && room.players.length) room.host_id = (humans(room)[0] || room.players[0]).id; };

/** Public lobby payload (same for everyone; clients know their own id). */
export function lobbyView(room) {
  return {
    code: room.code, hostId: room.host_id, phase: room.phase, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: !!p.ready, connected: !!p.connected, isHost: p.id === room.host_id, isBot: !!p.isBot, avatar: p.avatar, avatarData: p.avatar === 'custom' ? p.avatarData || null : null, color: p.color })),
    canStart: room.phase === 'lobby' && room.players.length >= MIN_PLAYERS && room.players.every((p) => p.ready || p.id === room.host_id) && room.players.filter((p) => p.connected).length >= MIN_PLAYERS,
  };
}

class Ctx {
  constructor(db, uid, now) { this.db = db; this.uid = uid; this.now = now; }
}

/** Main entry point. */
export async function handleOp({ db, uid, body, now = Date.now(), isService = false }) {
  const op = body && body.op;
  try {
    if (op === 'tick_all') { if (!isService) throw new GameError('Forbidden'); return await tickAll(db, now); }
    if (!uid) throw new GameError('Not signed in');
    for (let attempt = 0; attempt < 4; attempt++) {
      try { return await dispatch(new Ctx(db, uid, now), op, body || {}); }
      catch (e) { if (e && e.conflict && attempt < 3) continue; throw e; }
    }
  } catch (e) {
    if (e instanceof GameError || (e && e.expected)) return { ok: false, error: e.message };
    throw e;
  }
}
const fail = (msg) => { const e = new GameError(msg); e.expected = true; return e; };
const CONFLICT = () => { const e = new Error('conflict'); e.conflict = true; return e; };

async function dispatch(ctx, op, body) {
  const { db, uid, now } = ctx;
  switch (op) {
    case 'hello': return hello(ctx);
    case 'ping': { const m = await db.getMembership(uid); if (m) await db.touchMember(m.code, uid, now); return { ok: true }; }
    case 'create_room': return createRoom(ctx, body, false);
    case 'solo': return createRoom(ctx, body, true);
    case 'join_room': return joinRoom(ctx, body);
    case 'leave_room': return leaveRoom(ctx);
    case 'tick': return tickRoom(ctx, body.code);
    default: break;
  }
  // room-bound ops
  const m = await db.getMembership(uid);
  if (!m) throw fail('Not in a room');
  const room = await db.getRoom(m.code);
  if (!room) { await db.removeMember(m.code, uid); throw fail('Room not found'); }
  const me = room.players.find((p) => p.id === uid);
  if (!me) { await db.removeMember(m.code, uid); throw fail('Not in a room'); }
  await db.touchMember(room.code, uid, now);
  const r = new RoomOps(ctx, room);
  await r.load();
  r.touch(me);
  switch (op) {
    case 'set_profile': return r.setProfile(me, body.profile);
    case 'toggle_ready': return r.toggleReady(me);
    case 'add_bot': return r.addBot(me);
    case 'remove_bot': return r.removeBot(me);
    case 'start_game': return r.startGame(me);
    case 'back_to_lobby': return r.backToLobby(me);
    case 'new_game': return r.newGame(me);
    case 'game_action': return r.gameCall(me, (g) => g.declareAction(uid, body.action || {}));
    case 'game_challenge': return r.gameCall(me, (g) => g.challenge(uid));
    case 'game_challenge_target': return r.gameCall(me, (g) => g.challengeTarget(uid, body.targetId));
    case 'game_block': return r.gameCall(me, (g) => g.block(uid));
    case 'game_pass': return r.gameCall(me, (g) => g.pass(uid));
    case 'game_decision': return r.gameCall(me, (g) => g.decide(uid, body.choice || {}));
    default: throw fail('Unknown op');
  }
}

async function hello(ctx) {
  const { db, uid, now } = ctx;
  const m = await db.getMembership(uid);
  if (!m) return { ok: true, room: null, view: null };
  const room = await db.getRoom(m.code);
  if (!room || !room.players.find((p) => p.id === uid)) { await db.removeMember(m.code, uid); return { ok: true, room: null, view: null }; }
  await db.touchMember(room.code, uid, now);
  const r = new RoomOps(ctx, room); await r.load();
  let changed = r.refreshPresence();
  if (r.game) { if (r.game.tick(now)) changed = true; if (r.runBots()) changed = true; }
  if (changed) await r.commit();
  return { ok: true, room: lobbyView(r.room), view: r.game ? r.viewFor(uid) : null };
}

async function createRoom(ctx, body, solo) {
  const { db, uid, now } = ctx;
  const cur = await db.getMembership(uid);
  if (cur) { const old = await db.getRoom(cur.code); if (old && old.players.some((p) => p.id === uid)) throw fail('Leave your current room first'); await db.removeMember(cur.code, uid); }
  let code; for (let i = 0; i < 20; i++) { code = genCode(); if (!(await db.getRoom(code))) break; }
  const player = { id: uid, name: cleanName(body.name), ready: solo, connected: true, isBot: false, lastSeen: now, ...cleanProfile(body.profile) };
  const room = { code, host_id: uid, phase: 'lobby', players: [player], next_due: null, version: 0, created_at: now, updated_at: now };
  applyDefaults(room.players, player);
  await db.insertRoom(room);
  await db.addMember(code, uid, now);
  const r = new RoomOps(ctx, room); r.state = null; r.version = 0;
  if (solo) {
    const n = Math.max(1, Math.min(MAX_PLAYERS - 1, Number(body.bots) || 3));
    for (let i = 0; i < n; i++) r.pushBot();
    r.start({ guided: !!body.guided });
  }
  await r.commit();
  return { ok: true, code, room: lobbyView(r.room), view: r.game ? r.viewFor(uid) : null };
}

async function joinRoom(ctx, body) {
  const { db, uid, now } = ctx;
  const cur = await db.getMembership(uid);
  if (cur) { const old = await db.getRoom(cur.code); if (old && old.players.some((p) => p.id === uid) && old.code !== String(body.code || '').toUpperCase()) throw fail('Leave your current room first'); await db.removeMember(cur.code, uid); }
  const code = String(body.code || '').trim().toUpperCase();
  const room = await db.getRoom(code);
  if (!room) throw fail('Room not found');
  const r = new RoomOps(ctx, room); await r.load();
  if (room.players.some((p) => p.id === uid)) { await db.addMember(code, uid, now); r.refreshPresence(); await r.commit(); return { ok: true, code, room: lobbyView(r.room), view: r.game ? r.viewFor(uid) : null }; }
  if (room.phase !== 'lobby') throw fail('That game has already started');
  if (room.players.length >= MAX_PLAYERS) throw fail('Room is full');
  let name = cleanName(body.name);
  if (room.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) name = `${name.slice(0, 13)}#${room.players.length + 1}`;
  const player = { id: uid, name, ready: false, connected: true, isBot: false, lastSeen: now, ...cleanProfile(body.profile) };
  room.players.push(player); applyDefaults(room.players, player);
  await db.addMember(code, uid, now);
  await r.commit();
  return { ok: true, code, room: lobbyView(r.room), view: null };
}

async function leaveRoom(ctx) {
  const { db, uid } = ctx;
  const m = await db.getMembership(uid);
  if (!m) return { ok: true };
  const room = await db.getRoom(m.code);
  await db.removeMember(m.code, uid);
  if (!room) return { ok: true };
  const r = new RoomOps(ctx, room); await r.load();
  if (r.game && r.game.phase === 'playing') { const p = room.players.find((x) => x.id === uid); if (p) { p.connected = false; p.lastSeen = 0; } r.game.setConnected(uid, false); }
  else { room.players = room.players.filter((p) => p.id !== uid); pickHost(room); }
  if (!humans(room).length) { await db.deleteRoom(room.code); await db.deleteState(room.code); await db.deleteViews(room.code); return { ok: true }; }
  await r.commit();
  return { ok: true };
}

async function tickRoom(ctx, code) {
  const { db, now } = ctx;
  if (!code) { const m = await db.getMembership(ctx.uid); if (!m) return { ok: true }; code = m.code; }
  const room = await db.getRoom(String(code).toUpperCase());
  if (!room) return { ok: true };
  const r = new RoomOps(ctx, room); await r.load();
  if (ctx.uid && room.players.some((p) => p.id === ctx.uid)) { await db.touchMember(room.code, ctx.uid, now); r.members[ctx.uid] = now; }
  let changed = r.refreshPresence();
  if (r.game) { if (r.game.tick(now)) changed = true; if (r.runBots()) changed = true; }
  if (changed) await r.commit();
  return { ok: true, changed };
}

async function tickAll(db, now) {
  const codes = await db.listDueRooms(now);
  let n = 0;
  for (const code of codes) {
    try { const res = await handleOp({ db, uid: '__cron__', body: { op: 'tick', code }, now, isService: true }); if (res && res.changed) n++; } catch (e) { /* keep going */ }
  }
  return { ok: true, rooms: codes.length, changed: n };
}

/** All room-bound operations + persistence. */
class RoomOps {
  constructor(ctx, room) { this.ctx = ctx; this.db = ctx.db; this.now = ctx.now; this.room = room; this.game = null; this.state = null; this.version = 0; this.sched = {}; }
  async load() {
    this.members = {};
    for (const m of (await this.db.listMembers(this.room.code)) || []) this.members[m.user_id] = typeof m.last_seen === 'number' ? m.last_seen : (m.last_seen ? new Date(m.last_seen).getTime() : 0);
    const st = await this.db.getState(this.room.code);
    if (st && st.state && st.state.game) { this.version = st.version; this.sched = st.state.bots || {}; this.awarded = !!st.state.awarded; this.game = Game.fromJSON(st.state.game, { now: () => this.now }); }
    else { this.version = st ? st.version : 0; }
  }
  /** Bots plus any human who left — the computer plays their seat (auto mode), as long as someone is still watching. */
  botIds() {
    const humanWatching = this.room.players.some((p) => !p.isBot && p.connected);
    return this.room.players.filter((p) => p.isBot || (humanWatching && !p.connected)).map((p) => p.id);
  }
  runBots() { if (!this.game || this.game.phase !== 'playing') return false; return runBots(this.game, this.botIds(), this.sched, this.now); }
  /** Recompute `connected` from presence (members' last_seen); returns true if anything changed. */
  refreshPresence() {
    let changed = false;
    for (const p of this.room.players) {
      const seen = Math.max(p.lastSeen || 0, (this.members && this.members[p.id]) || 0);
      const c = p.isBot ? true : this.now - seen < PRESENCE_MS;
      if (p.connected !== c) { p.connected = c; changed = true; if (this.game) this.game.setConnected(p.id, c); }
    }
    return changed;
  }
  touch(me) { me.lastSeen = this.now; if (!me.connected) { me.connected = true; if (this.game) this.game.setConnected(me.id, true); } }
  viewFor(uid) { const v = this.game.viewFor(uid); v.nextDue = this.nextDue(); return v; }
  nextDue() { const a = this.game ? this.game.nextDue() : null; const b = this.game && this.game.phase === 'playing' ? botsNextDue(this.sched) : null; if (a == null) return b; if (b == null) return a; return Math.min(a, b); }
  async commit() {
    const { room } = this;
    room.phase = this.game ? this.game.phase : 'lobby';
    room.next_due = this.nextDue();
    room.updated_at = this.now;
    const expected = room.version; room.version = expected + 1;
    if (!(await this.db.updateRoom(room.code, room, expected))) throw CONFLICT();
    // Award trophies exactly once, when the game first reaches 'ended'. Persist the flag in state so a
    // retry/tick never double-awards; run the actual DB writes only after state is safely committed.
    let awards = null;
    if (this.game && this.game.phase === 'ended' && !this.awarded) { awards = standings(this.game); this.awarded = true; }
    const stExpected = this.version; this.version = stExpected + 1;
    const state = this.game ? { game: this.game.toJSON(), bots: this.sched, awarded: !!this.awarded } : null;
    if (!(await this.db.saveState(room.code, state, stExpected))) throw CONFLICT();
    const rows = humans(room).map((p) => ({ id: `${room.code}:${p.id}`, code: room.code, user_id: p.id, view: this.game ? this.viewFor(p.id) : null }));
    await this.db.upsertViews(rows);
    if (awards && this.db.bumpScore) {
      for (const a of awards) { try { await this.db.bumpScore(a.id, a.delta, a.win); } catch (e) { /* trophies are best-effort */ } }
    }
  }
  // ── lobby ops ──
  setProfile(me, raw) {
    const pr = cleanProfile(raw);
    if (pr.avatar) { me.avatar = pr.avatar; me.avatarData = pr.avatarData; }
    if (pr.color) me.color = pr.color;
    applyDefaults(this.room.players, me);
    if (this.game) this.game.setProfile(me.id, { avatar: me.avatar, color: me.color });
    return this.done();
  }
  toggleReady(me) { if (this.room.phase !== 'lobby') throw fail('Game in progress'); me.ready = !me.ready; return this.done({ ready: me.ready, room: lobbyView(this.room) }); }
  pushBot() {
    const room = this.room;
    if (room.players.length >= MAX_PLAYERS) throw fail('Room is full');
    const used = new Set(room.players.map((p) => p.name));
    const bot = { id: uuid(), name: BOT_NAMES.find((n) => !used.has(n)) || `Machine·${room.players.length + 1}`, ready: true, connected: true, isBot: true, avatar: null, avatarData: null, color: null };
    room.players.push(bot); applyDefaults(room.players, bot); return bot;
  }
  addBot(me) { if (this.room.host_id !== me.id) throw fail('Only the host can add bots'); if (this.room.phase !== 'lobby') throw fail('Game in progress'); this.pushBot(); return this.done({ room: lobbyView(this.room) }); }
  removeBot(me) {
    if (this.room.host_id !== me.id) throw fail('Only the host can remove bots'); if (this.room.phase !== 'lobby') throw fail('Game in progress');
    const idx = this.room.players.map((p) => p.isBot).lastIndexOf(true); if (idx < 0) throw fail('No bot to remove');
    this.room.players.splice(idx, 1); return this.done({ room: lobbyView(this.room) });
  }
  start(opts = {}) {
    const room = this.room;
    if (this.game && this.game.phase === 'playing') throw fail('Game already running');
    this.refreshPresence();
    const seated = room.players.filter((p) => p.connected);
    if (seated.length < MIN_PLAYERS) throw fail(`Need at least ${MIN_PLAYERS} connected players`);
    room.players = seated; pickHost(room);
    for (const p of room.players) applyDefaults(room.players, p);
    this.sched = {};
    // Guided (tutorial) games give beginners much longer windows so they can read the coach-marks.
    const timings = opts.guided ? { turn: 120000, challenge: 45000, block: 45000, decision: 60000, resultPause: 5000, turnPause: 3500 } : undefined;
    this.game = new Game(room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected, isBot: !!p.isBot, avatar: p.avatar, color: p.color })), { now: () => this.now, timings });
    this.game.start();
    this.runBots();
  }
  startGame(me) {
    if (this.room.host_id !== me.id) throw fail('Only the host can start');
    this.refreshPresence();
    if (!lobbyView(this.room).canStart) throw fail('Everyone must be ready (2–6 players)');
    this.start(); return this.done();
  }
  resetToLobby() {
    const room = this.room;
    this.game = null; this.sched = {};
    room.players = room.players.filter((p) => p.connected);
    for (const p of room.players) p.ready = !!p.isBot;
    pickHost(room);
  }
  backToLobby(me) { if (this.room.host_id !== me.id) throw fail('Only the host can do that'); if (this.game && this.game.phase === 'playing') throw fail('Game still running'); this.resetToLobby(); return this.done(); }
  newGame(me) {
    if (this.room.host_id !== me.id) throw fail('Only the host can start a new game');
    if (this.game && this.game.phase === 'playing') throw fail('Game still running');
    this.refreshPresence(); this.resetToLobby();
    if (this.room.players.filter((p) => p.connected).length < MIN_PLAYERS) { return this.done().then(() => { throw fail('Need at least 2 connected players — back to the lobby'); }); }
    this.start(); return this.done();
  }
  // ── game ops ──
  async gameCall(me, fn) {
    if (!this.game) throw fail('No game running');
    this.touch(me);
    this.refreshPresence();
    this.game.tick(this.now); // anything overdue happens first (e.g. a window that already expired)
    fn(this.game);
    this.runBots();
    // Return the caller's fresh view so the client can update instantly, without waiting for the Realtime round-trip.
    return this.done({ view: this.viewFor(me.id) });
  }
  async done(extra = {}) { await this.commit(); return { ok: true, ...extra }; }
}
