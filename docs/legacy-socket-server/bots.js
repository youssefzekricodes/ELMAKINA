'use strict';
// Simple bots for manual UI testing: node test/bots.js <ROOMCODE> [count]
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:8000';
const code = process.argv[2]; const count = Number(process.argv[3] || 2);
if (!code) { console.error('usage: node test/bots.js ROOMCODE [count]'); process.exit(1); }
const names = ['Bot-Amine', 'Bot-Leila', 'Bot-Karim', 'Bot-Nour', 'Bot-Sami'];
for (let i = 0; i < count; i++) {
  const s = io(URL, { transports: ['websocket'] });
  let me = null, busy = false;
  s.on('connect', () => s.emit('join_room', { name: names[i], code }, (r) => { if (!r.ok) { console.error(names[i], r.error); process.exit(1); } me = r.playerId; setTimeout(() => s.emit('toggle_ready'), 300); }));
  s.on('state', (st) => {
    if (!st.pending || st.phase !== 'playing' || busy) return;
    const p = st.pending, w = p.window;
    const act = (ev, data, delay) => { busy = true; setTimeout(() => { s.emit(ev, data || {}, () => { busy = false; }); }, delay); };
    if (p.stage === 'turn' && p.actorId === me) {
      const others = st.players.filter(x => x.alive && x.id !== me);
      const t = others[Math.floor(Math.random() * others.length)];
      const opts = [{ type: 'income' }, { type: 'businesswoman' }, { type: 'loan' }, { type: 'politician' }];
      if (t && t.coins > 0) opts.push({ type: 'thief', targetId: t.id });
      if (st.you.coins >= 3 && t) opts.push({ type: 'terrorist', targetId: t.id });
      act('game_action', opts[Math.floor(Math.random() * opts.length)], 2500);
    } else if (w && w.type === 'reaction' && w.eligible.includes(me) && !w.passed.includes(me)) {
      const r = Math.random();
      const ev = (w.claim && w.challengeEligible.includes(me) && r < 0.2) ? 'game_challenge'
        : (w.block && w.blockEligible.includes(me) && r < 0.45) ? 'game_block' : 'game_pass';
      act(ev, {}, 2500);
    } else if (w && w.type === 'decision' && w.playerId === me) {
      act('game_decision', w.kind === 'police' ? { swap: false } : { index: 0 }, 1500);
    }
  });
  s.on('disconnect', () => console.log(names[i], 'disconnected'));
}
console.log(`${count} bots joining ${code}…`);
