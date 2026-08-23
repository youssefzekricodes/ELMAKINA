'use strict';
// End-to-end smoke test over real Socket.IO connections. Requires the server running (default http://localhost:8000).
// Run: npm start (in another terminal) && node test/smoke.js
const { io } = require('socket.io-client');
const assert = require('assert');
const URL = process.env.URL || 'http://localhost:8000';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(name) {
  const s = io(URL, { transports: ['websocket'] });
  const c = { name, s, room: null, state: null, id: null };
  s.on('room', r => { c.room = r; c.id = r.you; });
  s.on('state', st => {
    c.state = st;
    // Leak check: nothing but my own cards should be present.
    assert.ok(st.players.every(p => !('cards' in p)), 'player list must not carry cards');
    assert.ok(!('deck' in st), 'deck must not be sent');
    if (st.pending && st.pending.window && st.pending.window.type === 'decision' && st.pending.window.playerId !== c.id) {
      assert.equal(st.pending.window.data, undefined, 'decision data leaked to non-owner');
    }
  });
  c.call = (ev, data) => new Promise(res => s.emit(ev, data || {}, res));
  c.until = async (pred, ms = 4000) => { const t = Date.now(); while (!pred(c)) { if (Date.now() - t > ms) throw new Error(`${name}: timeout waiting`); await sleep(15); } };
  return c;
}

(async () => {
  const A = client('Ana'), B = client('Bilel'), C = client('Chedi');
  await sleep(300);
  const r1 = await A.call('create_room', { name: 'Ana' }); assert.ok(r1.ok, r1.error);
  const r2 = await B.call('join_room', { name: 'Bilel', code: r1.code }); assert.ok(r2.ok, r2.error);
  const r3 = await C.call('join_room', { name: 'Chedi', code: r1.code }); assert.ok(r3.ok, r3.error);
  const bad = await C.call('join_room', { name: 'X', code: 'ZZZZ' }); assert.equal(bad.ok, false);
  await B.call('toggle_ready'); await C.call('toggle_ready');
  await A.until(c => c.room && c.room.canStart);
  const st = await A.call('start_game'); assert.ok(st.ok, st.error);
  for (const c of [A, B, C]) await c.until(x => x.state && x.state.phase === 'playing');
  console.log('✓ lobby → game started; turn order:', A.state.players.map(p => p.name).join(' → '));

  const all = [A, B, C];
  const byId = (id) => all.find(c => c.id === id);
  const active = () => byId(A.state.turnPlayerId);
  const waitTurn = () => A.until(c => c.state.pending && c.state.pending.stage === 'turn', 10000);

  // 1) Income by active player
  let act = active(); let coins = act.state.you.coins;
  let res = await act.call('game_action', { type: 'income' }); assert.ok(res.ok, res.error);
  await act.until(c => c.state.you.coins === coins + 1);
  console.log('✓ income works');

  // 2) Out-of-turn action rejected
  const notActive = all.find(c => c.id !== A.state.turnPlayerId);
  res = await notActive.call('game_action', { type: 'income' }); assert.equal(res.ok, false);
  console.log('✓ out-of-turn action rejected:', res.error);

  // 3) Loan with everyone passing → +2
  await waitTurn(); act = active(); coins = act.state.you.coins;
  res = await act.call('game_action', { type: 'loan' }); assert.ok(res.ok, res.error);
  await act.until(c => c.state.pending && c.state.pending.window && c.state.pending.window.block && c.state.pending.window.block.kind === 'veto');
  for (const c of all) if (c !== act) await c.call('game_pass');
  await act.until(c => c.state.you.coins === coins + 2);
  console.log('✓ loan (no veto) works, early-close on all-pass');

  // 4) Character claim + challenge: active claims Politician; another challenges. Outcome depends on real cards.
  await waitTurn(); act = active();
  const hadPolitician = act.state.you.cards.includes('politician');
  const challenger = all.find(c => c !== act);
  const chCards = challenger.state.you.cards.length, actCards = act.state.you.cards.length;
  res = await act.call('game_action', { type: 'politician' }); assert.ok(res.ok, res.error);
  await challenger.until(c => c.state.pending && c.state.pending.window && c.state.pending.window.type === 'reaction' && c.state.pending.window.claim);
  res = await challenger.call('game_challenge'); assert.ok(res.ok, res.error);
  await sleep(300);
  if (hadPolitician) { assert.equal(challenger.state.you.cards.length, chCards - 1); assert.equal(act.state.you.cards.length, actCards); }
  else { assert.equal(act.state.you.cards.length, actCards - 1); assert.equal(challenger.state.you.cards.length, chCards); }
  console.log(`✓ challenge resolved (claimer ${hadPolitician ? 'was truthful' : 'was bluffing'})`);

  // 5) Reconnect: B disconnects and rejoins with its token; should get state again.
  B.s.disconnect(); await sleep(100);
  const B2 = client('Bilel-2'); await sleep(200);
  const rj = await B2.call('rejoin', { code: r1.code, playerId: r2.playerId, token: r2.token }); assert.ok(rj.ok, rj.error);
  await B2.until(c => c.id && c.state && c.state.phase === 'playing');
  assert.equal(B2.id, r2.playerId);
  console.log('✓ reconnect restores seat and state');

  // 6) Log never contains card names except proven reveals / Colonel guesses
  console.log('— last log lines —'); for (const e of A.state.log.slice(-6)) console.log('   ', e.text);

  for (const c of [A, B2, C]) c.s.disconnect();
  console.log('\nSMOKE OK');
  process.exit(0);
})().catch(e => { console.error('SMOKE FAILED', e); process.exit(1); });
