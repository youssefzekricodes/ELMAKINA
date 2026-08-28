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

console.log(`\n${passed} test group(s) passed${process.exitCode ? ' (with failures)' : ''}`);
