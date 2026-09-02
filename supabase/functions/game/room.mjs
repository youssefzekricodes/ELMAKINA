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
 *   upsertViews(rows:[{id, code, user_id, view}]) | deleteViews(code) | deleteView(id) (optional) | listDueRooms(now) -> [code]
 *   reaper (all optional — a missing one just narrows the sweep):
 *     listIdleRooms(before, limit) -> [code]          rooms whose updated_at is older than `before`
 *     listStaleMemberRooms(before, limit) -> [code]   rooms holding a membership whose last_seen is older than `before`
 *     deleteMembers(code)                             drop every membership of one room
 */
import { Game, GameError, MIN_PLAYERS, MAX_PLAYERS, ACTION_GRACE, standings } from './engine.mjs';
import { BOTS, runBots, botsNextDue } from './bots.mjs';

export const DEFAULT_AVATARS = ['boy-1', 'boy-2', 'boy-3', 'boy-4', 'boy-5', 'boy-6', 'girl-1', 'girl-2', 'girl-3', 'girl-4', 'girl-5', 'girl-6'];
export const PALETTE = ['#2f7d32', '#d7a800', '#1e4fb5', '#b3261e', '#4b6b2b', '#5b2d9e', '#b5561a'];
const MAX_AVATAR_DATA = 120000;
export const PRESENCE_MS = 45000; // a member is "connected" if seen within this
// ── Room settings ──────────────────────────────────────────────────────────────────────────────
// How long every reaction window lasts (challenge + block). Host-configurable from the lobby via
// the `set_timings` op and stored on the room row (`settings.reactionSecs`), so it survives
// `new_game`. Out-of-range values are clamped rather than rejected — friendlier for a slider UI.
export const REACTION_SECS_DEFAULT = 12;
export const REACTION_SECS_MIN = 5;
export const REACTION_SECS_MAX = 60;
export const clampReactionSecs = (n) => Math.max(REACTION_SECS_MIN, Math.min(REACTION_SECS_MAX, Math.round(n)));
/** The reaction window (seconds) a room plays with — its own setting, or the default. */
export function reactionSecsOf(room) {
  const raw = room && room.settings ? Number(room.settings.reactionSecs) : NaN;
  return Number.isFinite(raw) ? clampReactionSecs(raw) : REACTION_SECS_DEFAULT;
}
// ── Room reaping ───────────────────────────────────────────────────────────────────────────────
// Nothing else ever deletes a room, so a closed tab would keep its row (plus game_state and
// game_views) in Postgres forever. Worst of all are solo/vs-bot games: `next_due` never runs out,
// so the bots would keep "playing" for eternity. The service-only `reap` sweep (also folded into
// `tick_all`) throws away rooms that are provably dead. Tune the thresholds here.
export const REAP_LIVE_MS = 120000;      // a human heartbeat newer than this ⇒ the room is live: never reaped
// Five minutes of nothing and the room goes. Every one of these is reached only AFTER the
// REAP_LIVE_MS check above has already established that no human has been heard from for two
// minutes, so a table people are actually sitting at is never touched by any of them.
export const REAP_ABANDONED_MS = 300000; //  5 min with no human heartbeat at all ⇒ dead, whatever the phase
export const REAP_ENDED_MS = 300000;     //  5 min: a finished game nobody renewed or closed
export const REAP_LOBBY_MS = 300000;     //  5 min: a lobby where nothing at all happened
export const REAP_ORPHAN_MS = 300000;    //  5 min: a room that has no membership rows left at all
export const REAP_MAX_AGE_MS = 43200000; // 12 h hard cap: nothing survives this long without a write
export const REAP_BATCH = 200;           // rooms examined per sweep
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const cleanName = (n) => String(n || '').trim().replace(/\s+/g, ' ').slice(0, 16) || 'Player';
export function cleanProfile(raw) {
  const out = { avatar: null, avatarData: null, color: null };
  if (!raw || typeof raw !== 'object') return out;
  if (raw.avatar === 'custom' && typeof raw.avatarData === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw.avatarData) && raw.avatarData.length <= MAX_AVATAR_DATA) { out.avatar = 'custom'; out.avatarData = raw.avatarData; }
  else if (DEFAULT_AVATARS.includes(raw.avatar)) out.avatar = raw.avatar;
  // `mv:<seed>` = a Multiavatar the client generates locally from the seed — any short seed is valid.
  else if (typeof raw.avatar === 'string' && /^mv:[A-Za-z0-9 _.-]{1,32}$/.test(raw.avatar)) out.avatar = raw.avatar;
  if (typeof raw.color === 'string' && PALETTE.includes(raw.color.toLowerCase())) out.color = raw.color.toLowerCase();
  return out;
}
export function genCode(rand = Math.random) { let code = ''; for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)]; return code; }
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

function applyDefaults(players, player) {
  // No avatar chosen → a Multiavatar seeded from the player's id: unique per player, drawn
  // client-side, and consistent with the faces the picker now offers (the photo set is legacy).
  if (!player.avatar) player.avatar = 'mv:' + String(player.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  if (!player.color) { const used = new Set(players.filter((p) => p !== player).map((p) => p.color)); player.color = PALETTE.find((c) => !used.has(c)) || PALETTE[players.indexOf(player) % PALETTE.length]; }
}
const humans = (room) => room.players.filter((p) => !p.isBot);

/**
 * Trophy deltas to actually write for a finished game. Ranking and the delta table live in
 * engine.mjs `standings()` — the client is shown the very same array.
 *
 * Nothing is awarded for a game containing a bot. Beating the machine was worth a full +3, so the
 * leaderboard could be farmed solo in a couple of minutes, which makes it worth nothing to the
 * people who earn it against real opponents.
 */
function trophyAwards(game) {
  const places = standings(game);
  if (places.some((p) => p.isBot)) return [];
  return places.map(({ id, delta, win }) => ({ id, delta, win }));
}
const pickHost = (room) => { if (!room.players.find((p) => p.id === room.host_id) && room.players.length) room.host_id = (humans(room)[0] || room.players[0]).id; };
/** Hand the host badge to a human who is still a member of the room (used when the host walks out mid-game). */
const pickHostFrom = (room, members) => { const h = humans(room).find((p) => p.id !== room.host_id && members && members[p.id] != null); if (h) room.host_id = h.id; };

/** Public lobby payload (same for everyone; clients know their own id). */
export function lobbyView(room) {
  return {
    code: room.code, hostId: room.host_id, phase: room.phase, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
    players: room.players.map((p) => ({ id: p.id, name: p.name, ready: !!p.ready, connected: !!p.connected, isHost: p.id === room.host_id, isBot: !!p.isBot, avatar: p.avatar, avatarData: p.avatar === 'custom' ? p.avatarData || null : null, color: p.color })),
    isPublic: !!room.is_public,
    canStart: room.phase === 'lobby' && room.players.length >= MIN_PLAYERS && room.players.every((p) => p.ready || p.id === room.host_id) && room.players.filter((p) => p.connected).length >= MIN_PLAYERS,
    reactionSecs: reactionSecsOf(room), minReactionSecs: REACTION_SECS_MIN, maxReactionSecs: REACTION_SECS_MAX,
  };
}

class Ctx {
  constructor(db, uid, now) { this.db = db; this.uid = uid; this.now = now; }
}

/** Main entry point. */
export async function handleOp({ db, uid, body, now = Date.now(), isService = false }) {
  const op = body && body.op;
  try {
    if (op === 'tick_all') { if (!isService) throw new GameError('Forbidden'); return await tickAll(db, now, body); }
    if (op === 'reap') { if (!isService) throw new GameError('Forbidden'); return await reapAll(db, now); }
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
    case 'public_rooms': return { ok: true, rooms: await db.listPublicRooms(Number(body.limit) || 30) };
    case 'quick_match': return quickMatch(ctx, body);
    case 'leave_room': return leaveRoom(ctx);
    case 'tick': return tickRoom(ctx, body.code);
    default: break;
  }
  // room-bound ops. Everything after the membership row is keyed by the same code, so it travels
  // as ONE parallel wave instead of four queries in single file — this preamble used to cost four
  // sequential round-trips before a move's logic even ran, and it is on the path of every click.
  const m = await db.getMembership(uid);
  if (!m) throw fail('Not in a room');
  const [room, memberRows, st] = await Promise.all([
    db.getRoom(m.code),
    db.listMembers(m.code),
    db.getState(m.code),
    db.touchMember(m.code, uid, now),   // heartbeat; nothing reads it back in this request
  ]);
  if (!room) { await db.removeMember(m.code, uid); throw fail('Room not found'); }
  const me = room.players.find((p) => p.id === uid);
  if (!me) { await db.removeMember(m.code, uid); throw fail('Not in a room'); }
  const r = new RoomOps(ctx, room);
  r.applyLoaded(memberRows, st);
  r.touch(me);
  switch (op) {
    case 'set_profile': return r.setProfile(me, body.profile, body.name);
    case 'toggle_ready': return r.toggleReady(me);
    case 'add_bot': return r.addBot(me);
    case 'remove_bot': return r.removeBot(me);
    case 'kick': return r.kick(me, body.targetId);
    case 'set_timings': return r.setTimings(me, body.seconds);
    case 'set_public': return r.setPublic(me, body.isPublic);
    case 'close_room': return r.closeRoom(me);
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
  if (r.game) { if (r.game.tick(now, ACTION_GRACE)) changed = true; if (r.runBots()) changed = true; }
  if (changed) await r.commit();
  return { ok: true, room: lobbyView(r.room), view: r.game ? r.viewFor(uid) : null };
}

async function createRoom(ctx, body, solo) {
  const { db, uid, now } = ctx;
  const cur = await db.getMembership(uid);
  if (cur) { const old = await db.getRoom(cur.code); if (old && old.players.some((p) => p.id === uid)) throw fail('Leave your current room first'); await db.removeMember(cur.code, uid); }
  let code; for (let i = 0; i < 20; i++) { code = genCode(); if (!(await db.getRoom(code))) break; }
  const player = { id: uid, name: cleanName(body.name), ready: solo, connected: true, isBot: false, lastSeen: now, ...cleanProfile(body.profile) };
  const room = { code, host_id: uid, phase: 'lobby', players: [player], settings: { reactionSecs: REACTION_SECS_DEFAULT }, is_public: !solo && !!body.isPublic, next_due: null, version: 0, created_at: now, updated_at: now };
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

/**
 * Quick match: drop into the fullest public lobby that still has a seat, else open one and wait.
 *
 * Deliberately not a matchmaking queue — it reuses joinRoom/createRoom whole, and "searching" is
 * just sitting in a lobby, which the client already knows how to render. Fullest-first (rather than
 * oldest) packs players into one room instead of scattering them one-per-lobby, which is the
 * difference between a game starting and everyone waiting alone.
 */
async function quickMatch(ctx, body) {
  const { db, uid } = ctx;
  let open = [];
  try { open = await db.listPublicRooms(30); } catch (e) { open = []; } // no listing → just open a room
  const cur = await db.getMembership(uid);
  const roomy = open
    .filter((r) => r.n > 0 && r.n < (r.max || MAX_PLAYERS) && !(cur && cur.code === r.code))
    .sort((a, b) => b.n - a.n);
  for (const cand of roomy) {
    try { return { ...(await joinRoom(ctx, { ...body, code: cand.code })), matched: true }; }
    catch (e) { /* filled up or vanished between the list and the join — try the next one */ }
  }
  return { ...(await createRoom(ctx, { ...body, isPublic: true }, false)), matched: false };
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

/** Leaving a *live* game is a forfeit: the player is eliminated on the spot (cards back to the deck) but
 *  the seat row stays so names/standings/log still resolve. In the lobby (or after the game) the seat goes. */
async function leaveRoom(ctx) {
  const { db, uid } = ctx;
  const m = await db.getMembership(uid);
  if (!m) return { ok: true };
  const room = await db.getRoom(m.code);
  await db.removeMember(m.code, uid);
  if (!room) return { ok: true };
  const r = new RoomOps(ctx, room); await r.load(); // members are re-read *after* the removal, so `uid` is gone
  if (r.game && r.game.phase === 'playing') {
    const p = room.players.find((x) => x.id === uid);
    if (p) { p.connected = false; p.lastSeen = 0; }
    r.game.forfeit(uid);
    r.runBots();
    if (room.host_id === uid) pickHostFrom(room, r.members); // never leave the room without a reachable host
  } else { room.players = room.players.filter((p) => p.id !== uid); pickHost(room); }
  // nobody with a live membership is left → tear the whole room down (a forfeited seat does not count)
  if (!humans(room).some((p) => r.members[p.id] != null)) { await db.deleteRoom(room.code); await db.deleteState(room.code); await db.deleteViews(room.code); return { ok: true }; }
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
  if (r.game) { if (r.game.tick(now, ACTION_GRACE)) changed = true; if (r.runBots()) changed = true; }
  if (changed) await r.commit();
  // Stop the bleeding at the source: the tick that finishes a game nobody is watching any more
  // (typically a solo game whose human closed the tab) tears the room down straight away instead
  // of leaving it for the reaper. Anyone still heart-beating keeps the room alive.
  if ((r.game ? r.game.phase : room.phase) === 'ended' && now - lastHumanSeen(room, r.members) >= REAP_LIVE_MS) {
    await reapRoom(db, room.code);
    return { ok: true, changed, reaped: true };
  }
  return { ok: true, changed };
}

/** Most recent heartbeat of a human who *still holds a membership row* (a forfeited/kicked seat does not count). */
export function lastHumanSeen(room, members) {
  let seen = 0;
  for (const p of (room && room.players) || []) {
    if (p.isBot) continue;
    const t = members ? members[p.id] : null;
    if (t == null) continue;
    seen = Math.max(seen, t, p.lastSeen || 0);
  }
  return seen;
}

/** Why this room is garbage — or null when it must be kept. Pure, so it is trivial to reason about and test.
 *  A room whose humans are still heart-beating (within REAP_LIVE_MS) is never touched, whatever its phase. */
export function reapReason(room, members, now) {
  if (!room) return 'gone';
  const idleWrite = now - (room.updated_at || room.created_at || 0);
  if (!members || Object.keys(members).length === 0) return idleWrite > REAP_ORPHAN_MS ? 'orphan' : null; // nobody is bound to it any more
  const idleHuman = now - lastHumanSeen(room, members);
  if (idleHuman < REAP_LIVE_MS) return idleWrite > REAP_MAX_AGE_MS ? 'max-age' : null; // somebody is right there — hands off
  if (idleHuman > REAP_ABANDONED_MS) return 'abandoned';                               // solo/vs-bot rooms die here
  if (room.phase === 'ended' && idleWrite > REAP_ENDED_MS) return 'ended';
  if (room.phase === 'lobby' && idleWrite > REAP_LOBBY_MS) return 'lobby';
  if (idleWrite > REAP_MAX_AGE_MS) return 'max-age';
  return null;
}

/** Delete every trace of one room. Safe to call on a room that is already (partly) gone. */
export async function reapRoom(db, code) {
  await db.deleteViews(code);
  await db.deleteState(code);
  if (db.deleteMembers) await db.deleteMembers(code);           // scoped by code — never touches another room's membership
  await db.deleteRoom(code);                                     // Postgres cascades members/state/views as a backstop
}

/** One sweep: cheap index-friendly queries pick candidates, then each one is re-checked against the
 *  live rows before anything is deleted. Idempotent — a second run simply finds nothing. */
export async function reapAll(db, now = Date.now(), limit = REAP_BATCH) {
  const codes = new Set();
  // (a) rooms with a stale heartbeat: catches solo/vs-bot games whose bots keep bumping updated_at
  if (db.listStaleMemberRooms) for (const c of (await db.listStaleMemberRooms(now - REAP_ABANDONED_MS, limit)) || []) codes.add(c);
  // (b) rooms nothing has written to in a while: catches idle lobbies, finished games and orphans
  const idleCut = Math.min(REAP_ORPHAN_MS, REAP_ENDED_MS, REAP_LOBBY_MS, REAP_MAX_AGE_MS);
  if (db.listIdleRooms) for (const c of (await db.listIdleRooms(now - idleCut, limit)) || []) codes.add(c);
  let reaped = 0; const reasons = {};
  for (const code of codes) {
    try {
      const room = await db.getRoom(code);
      if (!room) { if (db.deleteMembers) await db.deleteMembers(code); continue; } // membership rows pointing at nothing
      const members = {};
      for (const m of (await db.listMembers(code)) || []) members[m.user_id] = memberSeen(m);
      const reason = reapReason(room, members, now);
      if (!reason) continue;
      await reapRoom(db, code);
      reaped++; reasons[reason] = (reasons[reason] || 0) + 1;
    } catch (e) { /* one bad room must not stop the sweep */ }
  }
  return { ok: true, scanned: codes.size, reaped, reasons };
}

/** Cron entry point: one call reaps the dead rooms and then ticks the ones that are due.
 *  Pass `{ op:'tick_all', reap:false }` if you schedule ticks very often and prefer a separate,
 *  slower `{ op:'reap' }` schedule. */
async function tickAll(db, now, body) {
  const swept = body && body.reap === false ? { scanned: 0, reaped: 0, reasons: {} } : await reapAll(db, now); // reap first: no point ticking rooms that are about to go
  const codes = await db.listDueRooms(now);
  let n = 0;
  for (const code of codes) {
    try { const res = await handleOp({ db, uid: '__cron__', body: { op: 'tick', code }, now, isService: true }); if (res && res.changed) n++; } catch (e) { /* keep going */ }
  }
  return { ok: true, rooms: codes.length, changed: n, scanned: swept.scanned, reaped: swept.reaped, reasons: swept.reasons };
}

const memberSeen = (m) => (typeof m.last_seen === 'number' ? m.last_seen : (m.last_seen ? new Date(m.last_seen).getTime() : 0));

/** All room-bound operations + persistence. */
class RoomOps {
  constructor(ctx, room) { this.ctx = ctx; this.db = ctx.db; this.now = ctx.now; this.room = room; this.game = null; this.state = null; this.version = 0; this.sched = {}; }
  async load() {
    const [rows, st] = await Promise.all([this.db.listMembers(this.room.code), this.db.getState(this.room.code)]);
    this.applyLoaded(rows, st);
  }
  /** The synchronous half of load(), so a caller that already fetched in parallel can hand rows in. */
  applyLoaded(memberRows, st) {
    this.members = {};
    for (const m of memberRows || []) this.members[m.user_id] = memberSeen(m);
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
    if (this.game && this.game.phase === 'ended' && !this.awarded) { awards = trophyAwards(this.game); this.awarded = true; }
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
  setProfile(me, raw, rawName) {
    const pr = cleanProfile(raw);
    if (pr.avatar) { me.avatar = pr.avatar; me.avatarData = pr.avatarData; }
    if (pr.color) me.color = pr.color;
    // players may also rename themselves from inside the room; duplicates get a suffix like joining does
    if (rawName != null) {
      let name = cleanName(rawName);
      if (this.room.players.some((p) => p.id !== me.id && p.name.toLowerCase() === name.toLowerCase())) name = `${name.slice(0, 13)}#${this.room.players.indexOf(me) + 1}`;
      me.name = name;
    }
    applyDefaults(this.room.players, me);
    if (this.game) this.game.setProfile(me.id, { avatar: me.avatar, color: me.color, name: me.name });
    return this.done({ room: lobbyView(this.room) });
  }
  toggleReady(me) { if (this.room.phase !== 'lobby') throw fail('Game in progress'); me.ready = !me.ready; return this.done({ ready: me.ready, room: lobbyView(this.room) }); }
  pushBot() {
    const room = this.room;
    if (room.players.length >= MAX_PLAYERS) throw fail('Room is full');
    // Random pick from the unused roster, so the same three faces don't host every solo game.
    const used = new Set(room.players.map((p) => p.name));
    const pool = BOTS.filter((b) => !used.has(b.name));
    const b = pool.length ? pool[Math.floor(Math.random() * pool.length)] : { name: `Bot ${room.players.length + 1}`, avatar: null };
    const bot = { id: uuid(), name: b.name, ready: true, connected: true, isBot: true, avatar: b.avatar, avatarData: null, color: null };
    room.players.push(bot); applyDefaults(room.players, bot); return bot;
  }
  addBot(me) { if (this.room.host_id !== me.id) throw fail('Only the host can add bots'); if (this.room.phase !== 'lobby') throw fail('Game in progress'); this.pushBot(); return this.done({ room: lobbyView(this.room) }); }
  /** Host removes somebody from the lobby (works for bots too). Lobby only — nobody gets thrown out mid-game. */
  async kick(me, targetId) {
    const room = this.room;
    if (room.host_id !== me.id) throw fail('Only the host can remove players');
    if (this.game && this.game.phase === 'playing') throw fail('You cannot remove players while the game is running');
    if (room.phase !== 'lobby') throw fail('Go back to the lobby first to remove players');
    if (!targetId || targetId === me.id) throw fail('You cannot remove yourself');
    const idx = room.players.findIndex((p) => p.id === targetId);
    if (idx < 0) throw fail('That player is not in the room');
    const [gone] = room.players.splice(idx, 1);
    pickHost(room);
    if (!gone.isBot) await this.db.removeMember(room.code, gone.id); // their next hello/ping finds no room
    const res = await this.done({ room: lobbyView(room) });
    if (!gone.isBot && this.db.deleteView) { try { await this.db.deleteView(`${room.code}:${gone.id}`); } catch (e) { /* best effort */ } }
    return res;
  }
  /** Host sets how long every reaction window (challenge + block) lasts. Lobby only; the value is
   *  clamped to REACTION_SECS_MIN..REACTION_SECS_MAX and stored on the room, so it survives `new_game`. */
  setTimings(me, seconds) {
    const room = this.room;
    if (room.host_id !== me.id) throw fail('Only the host can change the reaction time');
    if (this.game && this.game.phase === 'playing') throw fail('You cannot change the reaction time while the game is running');
    if (room.phase !== 'lobby') throw fail('Go back to the lobby first to change the reaction time');
    const n = Number(seconds);
    if (!Number.isFinite(n)) throw fail(`Pick a reaction time between ${REACTION_SECS_MIN} and ${REACTION_SECS_MAX} seconds`);
    room.settings = { ...(room.settings || {}), reactionSecs: clampReactionSecs(n) };
    return this.done({ room: lobbyView(room) });
  }
  /**
   * List the room publicly, or take it back off the list. It lives here rather than at room
   * creation because it is a decision about a room you are already sitting in — and it is
   * reversible, which the create-time toggle never was.
   */
  setPublic(me, isPublic) {
    const room = this.room;
    if (room.host_id !== me.id) throw fail('Only the host can change who may join');
    if (room.phase !== 'lobby') throw fail('Go back to the lobby first to change who may join');
    room.is_public = !!isPublic;
    return this.done({ room: lobbyView(room) });
  }
  /** Host closes the room for everyone, in any phase: room, state, views and memberships all go. */
  async closeRoom(me) {
    const room = this.room;
    if (room.host_id !== me.id) throw fail('Only the host can close the room');
    const code = room.code;
    await this.db.deleteViews(code);
    await this.db.deleteState(code);
    for (const id of Object.keys(this.members || {})) await this.db.removeMember(code, id); // only members of *this* room
    await this.db.deleteRoom(code);
    return { ok: true, closed: true };
  }
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
    this.awarded = false; // fresh game must award trophies again (flag persists across ops in state)
    // The host's reaction time (challenge + block windows) applies to every game this room plays.
    // Guided (tutorial) games give beginners much longer windows so they can read the coach-marks —
    // those win over the room setting, on purpose.
    const secs = reactionSecsOf(room);
    const timings = Object.assign(
      { challenge: secs * 1000, block: secs * 1000 },
      opts.guided ? { turn: 120000, challenge: 45000, block: 45000, decision: 60000, resultPause: 5000, turnPause: 3500 } : null,
    );
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
    // Fire anything truly overdue first, but give the caller's own move the grace window: a click made
    // with time left that lands a moment late still counts instead of being pre-empted by the timeout.
    this.game.tick(this.now, ACTION_GRACE);
    fn(this.game);
    this.runBots();
    // Return the caller's fresh view so the client can update instantly, without waiting for the Realtime round-trip.
    return this.done({ view: this.viewFor(me.id) });
  }
  async done(extra = {}) { await this.commit(); return { ok: true, ...extra }; }
}
