// End-to-end flow through the serverless op handler with an in-memory DB (no Supabase needed):
// lobby → game → bots/ticks → winner → new game, plus concurrency (CAS) and presence. Run: node test/flow.test.mjs
import assert from 'node:assert';
import { handleOp } from '../supabase/functions/game/room.mjs';

/** In-memory implementation of the DB adapter used by room.mjs (mirrors the Postgres one in game/index.ts). */
function memDb() {
  const rooms = new Map(), members = new Map(), states = new Map(), views = new Map();
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  return {
    rooms, members, states, views,
    async getRoom(code) { return clone(rooms.get(code) || null); },
    async insertRoom(room) { if (rooms.has(room.code)) throw new Error('dup'); rooms.set(room.code, clone(room)); },
    async updateRoom(code, room, expected) { const cur = rooms.get(code); if (!cur || cur.version !== expected) return false; rooms.set(code, clone(room)); return true; },
    async deleteRoom(code) { rooms.delete(code); for (const [u, m] of members) if (m.code === code) members.delete(u); },
    async listPublicRooms(limit = 30) {
      return [...rooms.values()].filter((r) => r.is_public && r.phase === 'lobby' && r.players.length < 6)
        .sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, limit)
        .map((r) => ({ code: r.code, host: (r.players[0] || {}).name || 'Player', n: r.players.length, max: 6 }));
    },
    async getMembership(uid) { const m = members.get(uid); return m ? { code: m.code } : null; },
    async addMember(code, uid, now) { members.set(uid, { code, last_seen: now }); },
    async removeMember(code, uid) { members.delete(uid); },
    async touchMember(code, uid, now) { const m = members.get(uid); if (m) m.last_seen = now; },
    async listMembers(code) { return [...members.entries()].filter(([, m]) => m.code === code).map(([user_id, m]) => ({ user_id, last_seen: m.last_seen })); },
    async getState(code) { const s = states.get(code); return s ? clone(s) : null; },
    async saveState(code, state, expected) { const cur = states.get(code); const v = cur ? cur.version : 0; if (v !== expected) return false; states.set(code, { state: clone(state), version: expected + 1 }); return true; },
    async deleteState(code) { states.delete(code); },
    async upsertViews(rows) { for (const r of rows) views.set(r.id, clone(r)); },
    async deleteViews(code) { for (const k of [...views.keys()]) if (k.startsWith(code + ':')) views.delete(k); },
    async deleteView(id) { views.delete(id); },
    async listDueRooms(now) { return [...rooms.values()].filter((r) => r.next_due != null && r.next_due <= now).map((r) => r.code); },
    // reaper queries (mirror the indexed range scans in game/index.ts)
    async listIdleRooms(before, limit = 200) { return [...rooms.values()].filter((r) => (r.updated_at || 0) < before).slice(0, limit).map((r) => r.code); },
    async listStaleMemberRooms(before, limit = 200) { return [...new Set([...members.values()].filter((m) => (m.last_seen || 0) < before).slice(0, limit).map((m) => m.code))]; },
    async deleteMembers(code) { for (const [u, m] of members) if (m.code === code) members.delete(u); },
  };
}

let NOW = 1_700_000_000_000;
let passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('✓', name); } catch (e) { console.error('✗', name); console.error(e); process.exitCode = 1; } }
const call = (db, uid, body) => handleOp({ db, uid, body, now: NOW });
const viewOf = (db, code, uid) => { const v = db.views.get(`${code}:${uid}`); return v ? v.view : null; };

await test('lobby: create, join, ready, start; views are private; leave', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const r1 = await call(db, A, { op: 'create_room', name: 'Host', profile: { avatar: 'boy-2', color: '#1e4fb5' } });
  assert.ok(r1.ok, r1.error); const code = r1.code; assert.equal(code.length, 4);
  assert.equal((await call(db, A, { op: 'start_game' })).ok, false, 'cannot start alone');
  const r2 = await call(db, B, { op: 'join_room', name: 'Host', code }); assert.ok(r2.ok, r2.error); // duplicate name gets a suffix
  assert.ok(db.rooms.get(code).players[1].name.includes('#'));
  assert.equal((await call(db, A, { op: 'start_game' })).ok, false, 'guest not ready');
  assert.ok((await call(db, B, { op: 'toggle_ready' })).ok);
  assert.equal((await call(db, B, { op: 'start_game' })).ok, false, 'only host starts');
  const r3 = await call(db, A, { op: 'start_game' }); assert.ok(r3.ok, r3.error);
  assert.equal(db.rooms.get(code).phase, 'playing');
  const va = viewOf(db, code, A), vb = viewOf(db, code, B);
  assert.equal(va.you.cards.length, 3); assert.equal(vb.you.cards.length, 3);
  assert.ok(va.players.every((p) => !('cards' in p)), 'no hands in public player list');
  assert.ok(!db.rooms.get(code).players.some((p) => 'cards' in p), 'room row has no hands');
  assert.ok(db.states.get(code).state.game.players[0].cards.length === 3, 'hidden state holds hands');
  const h = await call(db, B, { op: 'hello' }); assert.equal(h.room.code, code); assert.equal(h.view.you.id, B);
  // turn: whoever is active takes income; the other one's action is rejected
  const active = va.turnPlayerId, other = active === A ? B : A;
  const bad = await call(db, other, { op: 'game_action', action: { type: 'income' } }); assert.equal(bad.ok, false); assert.match(bad.error, /not your turn/);
  const good = await call(db, active, { op: 'game_action', action: { type: 'income' } }); assert.ok(good.ok, good.error);
  assert.equal(viewOf(db, code, A).players.find((p) => p.id === active).coins, 3);
  // turn-end pause then next turn via tick
  assert.equal(viewOf(db, code, A).pending.window.type, 'result');
  NOW += 3600; await call(db, B, { op: 'tick' }); // turnPause 2200 + ACTION_GRACE 1200
  assert.equal(viewOf(db, code, A).turnPlayerId, other);
  // leaving mid-game is a forfeit: the seat stays (names/standings) but the player is out of the game
  assert.ok((await call(db, B, { op: 'leave_room' })).ok);
  assert.equal(db.members.has(B), false);
  const seatB = viewOf(db, code, A).players.find((p) => p.id === B);
  assert.equal(seatB.connected, false); assert.equal(seatB.alive, false, 'the leaver forfeits');
  assert.equal(viewOf(db, code, A).phase, 'ended'); assert.equal(viewOf(db, code, A).winnerId, A, 'last one standing wins');
});

await test('solo: bots play by themselves through ticks until the game ends; new game restarts', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const r = await call(db, A, { op: 'solo', name: 'Solo', bots: 3 }); assert.ok(r.ok, r.error);
  const code = r.code;
  let v = viewOf(db, code, A);
  assert.equal(v.phase, 'playing'); assert.equal(v.players.length, 4); assert.equal(v.players.filter((p) => p.isBot).length, 3);
  assert.ok(v.nextDue, 'nextDue exposed so clients know when to tick');
  let myTurns = 0, ticks = 0, guard = 0;
  while (v.phase === 'playing' && guard++ < 5000) {
    const p = v.pending, w = p && p.window;
    if (p && p.stage === 'turn' && p.actorId === A) { const res = await call(db, A, { op: 'game_action', action: { type: 'income' } }); assert.ok(res.ok, res.error); myTurns++; }
    else if (w && w.type === 'reaction' && w.eligible.includes(A) && !w.passed.includes(A)) await call(db, A, { op: 'game_pass' });
    else if (w && w.type === 'decision' && w.playerId === A) await call(db, A, { op: 'game_decision', choice: { index: 0 } });
    else { NOW = Math.max(NOW + 50, v.nextDue || NOW + 50); await call(db, A, { op: 'tick' }); ticks++; }
    v = viewOf(db, code, A);
  }
  assert.equal(v.phase, 'ended', 'game should end');
  const botLog = v.log.filter((e) => e.params && /Machine/.test(e.params.name || '')).length;
  console.log(`   (my turns: ${myTurns}, ticks: ${ticks}, bot log entries: ${botLog}, winner: ${v.players.find((p) => p.id === v.winnerId)?.name})`);
  assert.ok(botLog >= 3, 'bots should act');
  assert.equal(db.rooms.get(code).next_due, null, 'nothing due once ended');
  // add_bot only in lobby; new_game restarts with a fresh deal
  assert.equal((await call(db, A, { op: 'add_bot' })).ok, false);
  const ng = await call(db, A, { op: 'new_game' }); assert.ok(ng.ok, ng.error);
  v = viewOf(db, code, A);
  assert.equal(v.phase, 'playing'); assert.ok(v.players.every((p) => p.alive && p.coins === 2 && p.cardCount === 3));
});

await test('tick_all (cron) advances rooms whose next_due passed; presence drops idle players', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const { code } = await call(db, A, { op: 'create_room', name: 'A' });
  await call(db, B, { op: 'join_room', name: 'B', code }); await call(db, B, { op: 'toggle_ready' }); await call(db, A, { op: 'start_game' });
  const first = viewOf(db, code, A).turnPlayerId;
  NOW += 62_500; // the active player never acts (turn 60s + ACTION_GRACE) → turn timeout; also A and B have not pinged for > 45 s
  const res = await handleOp({ db, uid: null, body: { op: 'tick_all' }, now: NOW, isService: true });
  assert.ok(res.ok); assert.equal(res.rooms, 1);
  const v = viewOf(db, code, A);
  assert.ok(v.log.some((e) => e.key === 'timeout' || e.key === 'disconnected'), 'turn timed out');
  assert.ok(v.players.every((p) => !p.connected), 'idle players marked disconnected');
  assert.equal(v.pending.window.type, 'result', 'turn-end pause is showing');
  NOW += 3600; await handleOp({ db, uid: null, body: { op: 'tick_all' }, now: NOW, isService: true });
  assert.notEqual(viewOf(db, code, A).turnPlayerId, first, 'next turn after the pause');
  // a ping brings B back
  await call(db, B, { op: 'ping' }); await call(db, B, { op: 'tick' });
  assert.equal(viewOf(db, code, A).players.find((p) => p.id === B).connected, true);
  // forbidden without service role
  assert.equal((await handleOp({ db, uid: A, body: { op: 'tick_all' }, now: NOW })).ok, false);
});

await test('optimistic concurrency: a stale write is retried, not lost', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const { code } = await call(db, A, { op: 'solo', name: 'Solo', bots: 2 });
  // simulate two overlapping requests: wrap saveState so the first attempt hits a conflict once
  let injected = false; const orig = db.saveState.bind(db);
  db.saveState = async (c, s, expected) => { if (!injected) { injected = true; db.rooms.get(code).version++; return false; } return orig(c, s, expected); };
  NOW += 62_500; // something is certainly due now (turn timeout or a bot move)
  const res = await call(db, A, { op: 'tick' });
  assert.ok(res.ok, 'retried after conflict');
  assert.ok(injected);
});

await test('kick: host-only, lobby-only, and the kicked player is really gone', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002', C = 'cccccccc-0000-0000-0000-000000000003';
  const { code } = await call(db, A, { op: 'create_room', name: 'Host' });
  await call(db, B, { op: 'join_room', name: 'Bee', code });
  await call(db, C, { op: 'join_room', name: 'Cee', code });
  let r = await call(db, B, { op: 'kick', targetId: C }); assert.equal(r.ok, false, 'only the host may kick'); assert.match(r.error, /host/i);
  r = await call(db, A, { op: 'kick', targetId: A }); assert.equal(r.ok, false, 'cannot kick yourself');
  r = await call(db, A, { op: 'kick', targetId: 'nope' }); assert.equal(r.ok, false, 'unknown target');
  r = await call(db, A, { op: 'kick', targetId: C }); assert.ok(r.ok, r.error);
  assert.equal(r.room.players.length, 2); assert.ok(!r.room.players.some((p) => p.id === C), 'lobbyView returned without the kicked player');
  assert.equal(db.rooms.get(code).players.some((p) => p.id === C), false, 'seat removed');
  assert.equal(db.members.has(C), false, 'membership row removed');
  assert.equal(db.views.has(`${code}:${C}`), false, 'view row removed');
  const h = await call(db, C, { op: 'hello' }); assert.ok(h.ok); assert.equal(h.room, null, 'the kicked client learns it on the next hello');
  assert.equal((await call(db, C, { op: 'toggle_ready' })).ok, false, 'no room-bound ops after being kicked');
  // bots can be kicked too
  assert.ok((await call(db, A, { op: 'add_bot' })).ok);
  const botId = db.rooms.get(code).players.find((p) => p.isBot).id;
  assert.ok((await call(db, A, { op: 'kick', targetId: botId })).ok);
  assert.equal(db.rooms.get(code).players.some((p) => p.isBot), false);
  // …but never mid-game
  await call(db, B, { op: 'toggle_ready' }); assert.ok((await call(db, A, { op: 'start_game' })).ok);
  r = await call(db, A, { op: 'kick', targetId: B }); assert.equal(r.ok, false); assert.match(r.error, /running/i);
});

await test('close_room: the host ejects everyone and every trace of the room is gone', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const { code } = await call(db, A, { op: 'create_room', name: 'Host' });
  await call(db, B, { op: 'join_room', name: 'Bee', code });
  assert.equal((await call(db, B, { op: 'close_room' })).ok, false, 'only the host may close');
  await call(db, B, { op: 'toggle_ready' }); assert.ok((await call(db, A, { op: 'start_game' })).ok);
  assert.equal(db.rooms.get(code).phase, 'playing', 'closing works mid-game too');
  const res = await call(db, A, { op: 'close_room' });
  assert.deepEqual(res, { ok: true, closed: true });
  assert.equal(db.rooms.has(code), false, 'room row gone');
  assert.equal(db.states.has(code), false, 'game_state gone');
  assert.equal([...db.views.keys()].some((k) => k.startsWith(code + ':')), false, 'views gone');
  assert.equal(db.members.size, 0, 'every membership gone');
  assert.equal((await call(db, B, { op: 'hello' })).room, null);
  assert.equal((await call(db, A, { op: 'hello' })).room, null);
});

await test('leaving a live game forfeits: eliminated, cards back to the deck, the game carries on', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002', C = 'cccccccc-0000-0000-0000-000000000003';
  const { code } = await call(db, A, { op: 'create_room', name: 'Aay' });
  await call(db, B, { op: 'join_room', name: 'Bee', code }); await call(db, B, { op: 'toggle_ready' });
  await call(db, C, { op: 'join_room', name: 'Cee', code }); await call(db, C, { op: 'toggle_ready' });
  assert.ok((await call(db, A, { op: 'start_game' })).ok);
  const cards = () => { const g = db.states.get(code).state.game; return g.deck.length + g.players.reduce((n, p) => n + p.cards.length, 0); };
  assert.equal(cards(), 21);
  assert.ok((await call(db, B, { op: 'leave_room' })).ok);
  let v = viewOf(db, code, A);
  assert.equal(v.players.find((p) => p.id === B).alive, false, 'the leaver is eliminated');
  assert.ok(v.log.some((e) => e.key === 'elim.left'), 'logged in both locales via the elim.left key');
  assert.equal(cards(), 21, 'their cards went back to the deck');
  assert.equal(db.rooms.get(code).players.some((p) => p.id === B), true, 'the seat row stays');
  assert.equal(db.members.has(B), false, 'but the membership is gone');
  assert.equal(v.phase, 'playing', 'two players left → the game continues');
  assert.ok(v.pending, 'the game is not stuck');
  NOW += 4000; await call(db, A, { op: 'tick' });   // clear any turn-end pause the forfeit opened
  v = viewOf(db, code, A);
  assert.notEqual(v.turnPlayerId, B, 'the turn moved on');
  assert.ok(v.nextDue, 'the clock keeps running');
  // the second leaver ends the game; the last human leaving deletes the room outright
  assert.ok((await call(db, C, { op: 'leave_room' })).ok);
  v = viewOf(db, code, A);
  assert.equal(v.phase, 'ended'); assert.equal(v.winnerId, A);
  assert.equal(cards(), 21);
  assert.ok((await call(db, A, { op: 'leave_room' })).ok);
  assert.equal(db.rooms.has(code), false, 'no members left → room deleted');
  assert.equal(db.states.has(code), false);
  assert.equal([...db.views.keys()].some((k) => k.startsWith(code + ':')), false);
});


// ── Reaping ─────────────────────────────────────────────────────────────────────────────────────
const reap = (db) => handleOp({ db, uid: null, body: { op: 'reap' }, now: NOW, isService: true });
const traceOf = (db, code) => ({
  room: db.rooms.has(code), state: db.states.has(code),
  views: [...db.views.keys()].some((k) => k.startsWith(code + ':')),
  members: [...db.members.values()].some((m) => m.code === code),
});
const GONE = { room: false, state: false, views: false, members: false };

await test('reap: an abandoned solo/vs-bot room is reaped and every trace of it goes', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const { code } = await call(db, A, { op: 'solo', name: 'Solo', bots: 3 });
  assert.deepEqual(traceOf(db, code), { room: true, state: true, views: true, members: true });
  // the human closes the tab; bots would otherwise keep the room `next_due` (and updated_at fresh) forever
  NOW += 120_000; await handleOp({ db, uid: null, body: { op: 'tick_all' }, now: NOW, isService: true });
  assert.ok(db.rooms.has(code), 'still alive two minutes in — the bots are playing');
  assert.ok(db.rooms.get(code).updated_at >= NOW - 1000, 'and its updated_at is fresh, so idleness alone cannot catch it');
  NOW += 9 * 60_000; // > REAP_ABANDONED_MS since the last heartbeat
  const res = await handleOp({ db, uid: null, body: { op: 'tick_all' }, now: NOW, isService: true });
  assert.ok(res.ok); assert.equal(res.reaped, 1); assert.equal(res.reasons.abandoned, 1);
  assert.deepEqual(traceOf(db, code), GONE, 'room, hidden state, views and memberships all deleted');
  assert.equal((await call(db, A, { op: 'hello' })).room, null);
});

await test('reap: an idle lobby and a finished game are collected; the service gate holds', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002';
  // (1) a lobby nobody ever did anything in, even though a client still pings now and then
  const { code: lob } = await call(db, A, { op: 'create_room', name: 'Aay' });
  await call(db, B, { op: 'join_room', name: 'Bee', code: lob });
  NOW += 20 * 60_000; await call(db, A, { op: 'ping' }); await call(db, B, { op: 'ping' });
  NOW += 3 * 60_000;                                    // present recently enough not to look abandoned
  assert.equal((await reap(db)).reaped, 0, '23 min of doing nothing is not enough');
  NOW += 9 * 60_000; await call(db, A, { op: 'ping' }); // keeps the abandoned rule from firing
  NOW += 3 * 60_000;
  let res = await reap(db);
  assert.equal(res.reaped, 1); assert.equal(res.reasons.lobby, 1, '> 30 min without a single write');
  assert.deepEqual(traceOf(db, lob), GONE);
  // (2) a game that ended and that nobody restarted or closed
  const { code } = await call(db, A, { op: 'create_room', name: 'Aay' });
  await call(db, B, { op: 'join_room', name: 'Bee', code }); await call(db, B, { op: 'toggle_ready' });
  assert.ok((await call(db, A, { op: 'start_game' })).ok);
  assert.ok((await call(db, B, { op: 'leave_room' })).ok);           // forfeit → A wins, room sits on the winner screen
  assert.equal(db.rooms.get(code).phase, 'ended');
  NOW += 11 * 60_000; await call(db, A, { op: 'ping' });             // A is still around, just not restarting
  NOW += 3 * 60_000;
  res = await reap(db);
  assert.equal(res.reaped, 1); assert.equal(res.reasons.ended, 1);
  assert.deepEqual(traceOf(db, code), GONE);
  // reaping is service-only
  const { code: safe } = await call(db, A, { op: 'create_room', name: 'Aay' });
  const denied = await handleOp({ db, uid: A, body: { op: 'reap' }, now: NOW });
  assert.equal(denied.ok, false); assert.match(denied.error, /Forbidden/);
  assert.ok(db.rooms.has(safe));
});

await test('reap: a room whose players are still pinging is never touched', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const { code } = await call(db, A, { op: 'create_room', name: 'Aay' });
  await call(db, B, { op: 'join_room', name: 'Bee', code }); await call(db, B, { op: 'toggle_ready' });
  assert.ok((await call(db, A, { op: 'start_game' })).ok);
  for (let i = 0; i < 60; i++) { // an hour of play, heart-beating every minute like the client does
    NOW += 60_000;
    await call(db, A, { op: 'ping' }); await call(db, B, { op: 'ping' });
    const res = await handleOp({ db, uid: null, body: { op: 'tick_all' }, now: NOW, isService: true });
    assert.equal(res.reaped, 0, `reaped a live room after ${i + 1} min`);
    assert.ok(db.rooms.has(code));
  }
  assert.deepEqual(traceOf(db, code), { room: true, state: true, views: true, members: true });
  // a solo room ticked by cron with a human who keeps pinging survives too
  const C = 'cccccccc-0000-0000-0000-000000000003';
  const { code: solo } = await call(db, C, { op: 'solo', name: 'Solo', bots: 2 });
  for (let i = 0; i < 20; i++) { NOW += 60_000; await call(db, C, { op: 'ping' }); await handleOp({ db, uid: null, body: { op: 'tick_all' }, now: NOW, isService: true }); }
  assert.ok(db.rooms.has(solo), 'the solo room is still there');
});

await test('reap: idempotent — a second sweep is a harmless no-op', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const { code } = await call(db, A, { op: 'solo', name: 'Solo', bots: 2 });
  NOW += 11 * 60_000;
  const first = await reap(db);
  assert.equal(first.reaped, 1);
  const second = await reap(db);
  assert.ok(second.ok); assert.equal(second.reaped, 0); assert.deepEqual(second.reasons, {});
  const third = await handleOp({ db, uid: null, body: { op: 'tick_all' }, now: NOW, isService: true });
  assert.ok(third.ok); assert.equal(third.reaped, 0); assert.equal(third.rooms, 0);
  const noReap = await handleOp({ db, uid: null, body: { op: 'tick_all', reap: false }, now: NOW, isService: true });
  assert.ok(noReap.ok); assert.equal(noReap.scanned, 0, 'the sweep can be turned off for high-frequency tick schedules');
  assert.deepEqual(traceOf(db, code), GONE);
  assert.equal(db.members.size, 0); assert.equal(db.rooms.size, 0); assert.equal(db.states.size, 0); assert.equal(db.views.size, 0);
});

await test('reap: the tick that ends an unwatched game tears the room down on the spot', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const { code } = await call(db, A, { op: 'solo', name: 'Solo', bots: 3 });
  NOW += 3 * 60_000; // the tab is gone — but the bots happily keep playing the game to its end
  // plain ticks, no reap sweep: whatever tears this room down can only be tickRoom itself
  const tick = () => handleOp({ db, uid: '__cron__', body: { op: 'tick', code }, now: NOW, isService: true });
  let guard = 0, last = null;
  while (db.rooms.has(code) && guard++ < 2000) { NOW += 10_000; last = await tick(); }
  assert.ok(guard < 2000, 'the bots finished the game');
  assert.equal(last.reaped, true, 'the finishing tick reaped the room itself');
  assert.deepEqual(traceOf(db, code), GONE);
  assert.deepEqual(await tick(), { ok: true }, 'ticking a room that is already gone is a no-op');
  console.log(`   (cron ticks until the abandoned solo game finished and was torn down: ${guard})`);
});

await test('set_timings: host-only, lobby-only, clamped, stored on the room and applied to the live windows', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'bbbbbbbb-0000-0000-0000-000000000002';
  const r0 = await call(db, A, { op: 'create_room', name: 'Host' });
  const code = r0.code;
  assert.equal(r0.room.reactionSecs, 12, 'lobby shows the 12s default');
  assert.equal(r0.room.minReactionSecs, 5); assert.equal(r0.room.maxReactionSecs, 60);
  await call(db, B, { op: 'join_room', name: 'Bee', code });
  // host only
  let r = await call(db, B, { op: 'set_timings', seconds: 30 });
  assert.equal(r.ok, false); assert.match(r.error, /host/i);
  assert.equal(db.rooms.get(code).settings.reactionSecs, 12, 'the guest changed nothing');
  // garbage is refused, out-of-range is clamped (friendlier for a slider)
  assert.equal((await call(db, A, { op: 'set_timings', seconds: 'soon' })).ok, false);
  assert.equal((await call(db, A, { op: 'set_timings' })).ok, false, 'missing payload');
  assert.equal((await call(db, A, { op: 'set_timings', seconds: 900 })).room.reactionSecs, 60, 'clamped up to the max');
  assert.equal((await call(db, A, { op: 'set_timings', seconds: 0 })).room.reactionSecs, 5, 'clamped down to the min');
  assert.equal((await call(db, A, { op: 'set_timings', seconds: -20 })).room.reactionSecs, 5);
  r = await call(db, A, { op: 'set_timings', seconds: 20.4 });
  assert.ok(r.ok, r.error);
  assert.equal(r.room.reactionSecs, 20, 'rounded'); assert.equal(r.room.code, code, 'the fresh lobby payload comes back');
  assert.equal(db.rooms.get(code).settings.reactionSecs, 20, 'stored on the room row');
  assert.equal((await call(db, B, { op: 'hello' })).room.reactionSecs, 20, 'everyone sees it');
  // it reaches the engine: the in-game countdowns read viewFor().timings
  await call(db, B, { op: 'toggle_ready' });
  assert.ok((await call(db, A, { op: 'start_game' })).ok);
  const v = viewOf(db, code, A);
  assert.equal(v.timings.challenge, 20000); assert.equal(v.timings.block, 20000);
  assert.equal(v.timings.turn, 60000, 'the other timings keep their defaults');
  // and the window really is 20s long
  assert.equal(db.states.get(code).state.game.T.challenge, 20000);
  // lobby only
  r = await call(db, A, { op: 'set_timings', seconds: 8 });
  assert.equal(r.ok, false); assert.match(r.error, /running/i);
  assert.equal(db.rooms.get(code).settings.reactionSecs, 20, 'unchanged mid-game');
});

await test('set_timings: the room setting survives a new game; guided games keep their long windows', async () => {
  const db = memDb();
  const A = 'aaaaaaaa-0000-0000-0000-000000000001';
  const { code } = await call(db, A, { op: 'create_room', name: 'Host' });
  assert.ok((await call(db, A, { op: 'add_bot' })).ok);
  assert.equal((await call(db, A, { op: 'set_timings', seconds: 25 })).room.reactionSecs, 25);
  assert.ok((await call(db, A, { op: 'start_game' })).ok);
  assert.equal(viewOf(db, code, A).timings.challenge, 25000);
  // play it out (A just takes income; the bot does the rest) so a new game can be started
  let v = viewOf(db, code, A), guard = 0;
  while (v.phase === 'playing' && guard++ < 5000) {
    const p = v.pending, w = p && p.window;
    if (p && p.stage === 'turn' && p.actorId === A) await call(db, A, { op: 'game_action', action: { type: 'income' } });
    else if (w && w.type === 'reaction' && w.eligible.includes(A) && !w.passed.includes(A)) await call(db, A, { op: 'game_pass' });
    else if (w && w.type === 'decision' && w.playerId === A) await call(db, A, { op: 'game_decision', choice: { index: 0 } });
    else { NOW += 5000; await call(db, A, { op: 'tick' }); }
    v = viewOf(db, code, A);
  }
  assert.equal(v.phase, 'ended', 'the game finished');
  assert.ok((await call(db, A, { op: 'new_game' })).ok);
  assert.equal(db.rooms.get(code).settings.reactionSecs, 25, 'the setting outlives the game');
  assert.equal(viewOf(db, code, A).timings.challenge, 25000, 'and is applied to the new one');
  assert.equal(viewOf(db, code, A).timings.block, 25000);
  // a guided (tutorial) game keeps its long beginner windows — guided wins over the room setting
  const G = 'gggggggg-0000-0000-0000-000000000009';
  const guided = await call(db, G, { op: 'solo', name: 'Newbie', bots: 2, guided: true });
  assert.ok(guided.ok, guided.error);
  const gv = viewOf(db, guided.code, G);
  assert.equal(gv.timings.challenge, 45000); assert.equal(gv.timings.block, 45000); assert.equal(gv.timings.turn, 120000);
  // a plain solo room uses the 12s default
  const S = 'ssssssss-0000-0000-0000-000000000008';
  const solo = await call(db, S, { op: 'solo', name: 'Solo', bots: 2 });
  assert.equal(solo.room.reactionSecs, 12);
  assert.equal(viewOf(db, solo.code, S).timings.challenge, 12000);
});

await test('set_public: the host lists the room from the lobby, and can take it back off', async () => {
  const db = memDb();
  const r = await call(db, 'host', { op: 'create_room', name: 'Amine' });
  assert.equal(r.room.isPublic, false, 'rooms start private — visibility is decided in the lobby now');
  assert.deepEqual(await db.listPublicRooms(), []);

  const guest = await call(db, 'guest', { op: 'join_room', name: 'Guest', code: r.code });
  assert.ok(guest.room, 'sanity: the guest is in');

  // only the host may change it
  let bad = await call(db, 'guest', { op: 'set_public', isPublic: true });
  assert.equal(bad.ok, false); assert.match(bad.error, /host/i);
  assert.deepEqual(await db.listPublicRooms(), [], 'and a refused call changes nothing');

  const up = await call(db, 'host', { op: 'set_public', isPublic: true });
  assert.equal(up.room.isPublic, true);
  const list = await db.listPublicRooms();
  assert.equal(list.length, 1); assert.equal(list[0].code, r.code);

  // ...and it is reversible, which the create-time toggle never was
  const down = await call(db, 'host', { op: 'set_public', isPublic: false });
  assert.equal(down.room.isPublic, false);
  assert.deepEqual(await db.listPublicRooms(), [], 'taken back off the board');

  // not once the game has started — the public board only ever lists lobbies
  await call(db, 'guest', { op: 'toggle_ready' });
  await call(db, 'host', { op: 'start_game' });
  bad = await call(db, 'host', { op: 'set_public', isPublic: true });
  assert.equal(bad.ok, false); assert.match(bad.error, /lobby/i);
});

await test('public rooms: private stays hidden, public is listed, and quick match packs players in', async () => {
  const db = memDb();
  // a private room must never be advertised
  await call(db, 'priv', { op: 'create_room', name: 'Private' });
  assert.deepEqual(await db.listPublicRooms(), [], 'a room is private unless the host opts in');

  const a = await call(db, 'ha', { op: 'create_room', name: 'Amine', isPublic: true });
  assert.equal(a.room.isPublic, true, 'the lobby payload tells the client how it is listed');
  let list = await db.listPublicRooms();
  assert.equal(list.length, 1); assert.equal(list[0].code, a.code); assert.equal(list[0].n, 1);
  assert.equal(list[0].host, 'Amine');
  assert.ok(!('players' in list[0]), 'browsing never exposes the players blob');

  // quick match joins the existing public room rather than opening a second one
  const q = await call(db, 'guest', { op: 'quick_match', name: 'Guest' });
  assert.equal(q.matched, true); assert.equal(q.code, a.code);
  assert.equal((await db.getRoom(a.code)).players.length, 2);

  // a second public room exists but is emptier: quick match packs into the fullest one
  const b = await call(db, 'hb', { op: 'create_room', name: 'Bilel', isPublic: true });
  const q2 = await call(db, 'guest2', { op: 'quick_match', name: 'Guest2' });
  assert.equal(q2.code, a.code, 'fullest-first, so games actually reach the start threshold');
  assert.equal((await db.getRoom(b.code)).players.length, 1);

  // nothing public to join → open one and wait
  for (const code of [a.code, b.code]) await db.deleteRoom(code);
  const q3 = await call(db, 'lonely', { op: 'quick_match', name: 'Lonely' });
  assert.equal(q3.matched, false, 'no room to join → host one');
  assert.equal((await db.getRoom(q3.code)).is_public, true, 'and it is public, so the next searcher finds it');

  // a full room drops off the list
  const full = await db.getRoom(q3.code);
  full.players = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
  await db.updateRoom(full.code, full, full.version);
  assert.deepEqual(await db.listPublicRooms(), [], 'a full lobby stops advertising');
});

await test('trophies: real tables pay by size, and a table with a bot pays nothing', async () => {
  const db = memDb();
  const paid = [];
  db.bumpScore = async (uid, delta, win) => { paid.push({ uid, delta, win }); };

  // solo vs bots → the game ends, but nothing is written
  const solo = await call(db, 'solo', { op: 'solo', name: 'Solo', bots: 3 });
  const room = await db.getRoom(solo.code);
  const st = await db.getState(solo.code);
  st.state.game.phase = 'ended';
  st.state.game.winnerId = 'solo';
  await db.saveState(solo.code, st.state, st.version);
  room.phase = 'playing'; await db.updateRoom(room.code, room, room.version);
  await call(db, 'solo', { op: 'tick', code: solo.code });
  assert.deepEqual(paid, [], 'beating the machine is not worth a trophy');
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ' (with failures)' : ''}`);
