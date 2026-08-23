// Solo mode: one human + 3 server bots; the bots must keep the game moving without errors. Server must be running.
const { io } = require('socket.io-client'); const assert = require('assert');
const URL = process.env.URL || 'http://localhost:8001'; const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const s = io(URL, { transports: ['websocket'] }); let state = null, room = null, me = null;
  s.on('state', st => { state = st; }); s.on('room', r => { room = r; me = r.you; });
  await sleep(200);
  const res = await new Promise(r => s.emit('solo', { name: 'Solo', bots: 3 }, r)); assert.ok(res.ok, res.error);
  await sleep(500);
  assert.equal(state.phase, 'playing'); assert.equal(state.players.length, 4); assert.equal(state.players.filter(p => p.isBot).length, 3);
  // play ~25 s: when it's my turn take Income; on reactions pass; on decisions pick index 0. Bots do the rest.
  const t0 = Date.now(); let myTurns = 0, botActs = 0, lastLog = 0;
  while (Date.now() - t0 < 40000 && state.phase === 'playing') {
    const p = state.pending, w = p && p.window;
    if (p && p.stage === 'turn' && p.actorId === me) { await new Promise(r => s.emit('game_action', { type: 'income' }, r)); myTurns++; }
    else if (w && w.type === 'reaction' && w.eligible.includes(me) && !w.passed.includes(me)) await new Promise(r => s.emit('game_pass', {}, r));
    else if (w && w.type === 'decision' && w.playerId === me) await new Promise(r => s.emit('game_decision', { index: 0 }, r));
    if (state.log.length > lastLog) { botActs += state.log.slice(lastLog).filter(e => e.params && /Machine/.test(e.params.name || '')).length; lastLog = state.log.length; }
    await sleep(100);
  }
  console.log(`my turns: ${myTurns}, bot log entries: ${botActs}, turns seen: ${state.log.filter(e => e.key === 'income' || (e.key || '').startsWith('claim.') || e.key === 'loan.ask' || e.key === 'paidkill').length}`);
  assert.ok(botActs >= 3, 'bots should act');
  assert.ok(myTurns >= 1, 'human should get turns');
  // add/remove bot only in lobby
  const r2 = await new Promise(r => s.emit('add_bot', {}, r)); assert.equal(r2.ok, false);
  console.log('✓ solo mode: bots play, human gets turns, game keeps flowing (phase:', state.phase + ')');
  s.close(); process.exit(0);
})().catch(e => { console.error('SOLO FAILED', e); process.exit(1); });
