'use strict';
// Engine-level scenario tests using very short timers. Run: node test/engine.test.js
const assert = require('assert');
const { Game, Queue, CHARACTERS, MAX_COINS } = require('../server/game');

const T = { challenge: 40, block: 40, decision: 40, turn: 200, disconnectedTurn: 30, disconnectedDecision: 20, resultPause: 0, turnPause: 0 };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('✓', name); }
  catch (e) { console.error('✗', name); console.error(e); process.exitCode = 1; }
}
const live = new Set();
function track(g) { live.add(g); return g; }
function giveCard(g, pid, ch) {
  const p = g.player(pid);
  if (p.cards.includes(ch)) return;
  let deckArr = g.deck.toArray();
  if (!deckArr.includes(ch)) { // pull a copy from another player's hand into the deck first
    const holder = g.players.find(x => x.id !== pid && x.cards.includes(ch));
    const j = holder.cards.indexOf(ch); holder.cards[j] = deckArr.shift(); deckArr.push(ch);
  }
  const i = deckArr.indexOf(ch);
  g.deck = new Queue(deckArr.filter((_, k) => k !== i)); g.deck.push(p.cards.pop()); p.cards.push(ch);
}
function withoutCard(g, pid, ch) { const p = g.player(pid); while (p.cards.includes(ch)) { const i = p.cards.indexOf(ch); const other = g.deck.toArray().find(c => c !== ch); const arr = g.deck.toArray(); arr.splice(arr.indexOf(other), 1); g.deck = new Queue(arr); g.deck.push(p.cards[i]); p.cards[i] = other; } }

(async () => {
  await test('Queue is FIFO', () => {
    const q = new Queue(['a', 'b', 'c']);
    assert.equal(q.shift(), 'a'); q.push('a'); assert.deepEqual(q.toArray(), ['b', 'c', 'a']); assert.equal(q.length, 3);
  });

  await test('setup: 21 cards, hand sizes, coins, total conservation', () => {
    for (const n of [2, 4, 5, 6]) {
      const g = track(new Game(mk(n), { timings: T }));
      const hand = n <= 4 ? 3 : 2;
      assert.ok(g.players.every(p => p.cards.length === hand && p.coins === 2));
      assert.equal(g.deck.length + n * hand, 21);
      const all = [...g.deck.toArray(), ...g.players.flatMap(p => p.cards)];
      for (const c of CHARACTERS) assert.equal(all.filter(x => x === c).length, 3);
      g.destroy();
    }
  });

  await test('view never leaks other hands', () => {
    const g = track(new Game(mk(3), { timings: T }));
    const v = g.viewFor('p0');
    assert.ok(v.you.cards.length === 3);
    assert.ok(v.players.every(p => !('cards' in p)));
    assert.ok(!JSON.stringify(v).includes('"deck"'));
    g.destroy();
  });

  await test('income, loan (no veto), coin cap at 14', async () => {
    const g = track(new Game(mk(2), { timings: T })); g.start();
    const a = g.active;
    g.declareAction(a.id, { type: 'income' });
    assert.equal(a.coins, 3);
    const b = g.active; assert.notEqual(b.id, a.id);
    g.declareAction(b.id, { type: 'loan' });
    assert.equal(g.pending.window.type, 'reaction'); assert.equal(g.pending.window.block.kind, 'veto');
    await sleep(60);
    assert.equal(b.coins, 4);
    b.coins = 13; // next: a's turn; give b a loan to test cap
    g.declareAction(g.active.id, { type: 'income' });
    g.declareAction(b.id, { type: 'loan' }); g.pass(a.id);
    assert.equal(b.coins, 14);
    g.destroy();
  });

  await test('loan veto: truthful tax man veto stops loan, challenger loses a card', async () => {
    const g = track(new Game(mk(3), { timings: T })); g.start();
    const a = g.active; const others = g.players.filter(p => p.id !== a.id);
    const v = others[0], c = others[1];
    giveCard(g, v.id, 'taxman');
    g.declareAction(a.id, { type: 'loan' });
    g.block(v.id); // veto
    assert.equal(g.pending.window.type, 'reaction'); assert.ok(g.pending.window.claim && !g.pending.window.block);
    const cCards = c.cards.length;
    g.challenge(c.id);
    assert.equal(c.cards.length, cCards - 1);
    assert.equal(a.coins, 2); // vetoed
    assert.ok(v.cards.length === 3);
    g.destroy();
  });

  await test('bluff caught: claimer loses a card and action fails; terrorist cost not refunded', async () => {
    const g = track(new Game(mk(2), { timings: T })); g.start();
    const a = g.active, b = g.players.find(p => p.id !== a.id);
    a.coins = 5; withoutCard(g, a.id, 'terrorist');
    g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
    assert.equal(a.coins, 2);
    g.challenge(b.id);
    assert.equal(a.cards.length, 2); assert.equal(b.cards.length, 3);
    assert.equal(g.active.id, b.id);
    g.destroy();
  });

  await test('terrorist special case: target challenges truthful terrorist, loses 2 cards; chooses which', async () => {
    const g = track(new Game(mk(2), { timings: T })); g.start();
    const a = g.active, b = g.players.find(p => p.id !== a.id);
    a.coins = 5; giveCard(g, a.id, 'terrorist');
    g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
    g.challenge(b.id);
    assert.equal(b.cards.length, 2, 'lost one from challenge');
    assert.ok(a.cards.length === 3);
    assert.equal(g.pending.window.type, 'reaction'); assert.ok(!g.pending.window.claim && g.pending.window.block, 'b may still block with Colonel, claim proven'); 
    g.pass(b.id);
    assert.equal(g.pending.window.type, 'decision'); assert.equal(g.pending.window.kind, 'lose_card');
    g.decide(b.id, { index: 0 });
    assert.equal(b.cards.length, 1);
    assert.equal(g.phase, 'playing');
    g.destroy();
  });

  await test('block with Colonel: successful block stops kill; lying block fails and kill proceeds', async () => {
    const g = track(new Game(mk(3), { timings: T })); g.start();
    const a = g.active; const [b] = g.players.filter(p => p.id !== a.id);
    a.coins = 10; giveCard(g, a.id, 'terrorist'); giveCard(g, b.id, 'colonel');
    g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
    assert.equal(g.pending.window.type, 'reaction'); assert.ok(g.pending.window.claim && g.pending.window.block.kind === 'block');
    g.block(b.id); // target blocks straight away (bluff call was available underneath)
    await sleep(60); // nobody challenges the block
    assert.equal(b.cards.length, 3); assert.notEqual(g.active.id, a.id);
    // round to a again
    while (g.active.id !== a.id) g.declareAction(g.active.id, { type: 'income' });
    withoutCard(g, b.id, 'colonel');
    g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
    g.block(b.id);
    g.challenge(a.id); // block was a lie -> b loses a card, kill proceeds
    assert.equal(b.cards.length, 2);
    assert.equal(g.pending.window.type, 'decision');
    g.decide(b.id, { index: 1 });
    assert.equal(b.cards.length, 1);
    g.destroy();
  });

  await test('anyone may counter: a non-target blocks the Terrorist with Colonel', async () => {
    const g = track(new Game(mk(3), { timings: T })); g.start();
    const a = g.active; const [b, c] = g.players.filter(p => p.id !== a.id);
    a.coins = 5; giveCard(g, a.id, 'terrorist'); giveCard(g, c.id, 'colonel');
    g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
    assert.deepEqual([...g.pending.window.blockEligible].sort(), [b.id, c.id].sort());
    g.block(c.id);               // c (not the target) blocks
    g.challenge(a.id);           // a calls the bluff — c really has it
    assert.equal(a.cards.length, 2); assert.equal(b.cards.length, 3); assert.equal(c.cards.length, 3);
    assert.notEqual(g.active.id, a.id);
    g.destroy();
  });

  await test('paid kill: target can pay 9 to survive; otherwise chooses card', async () => {
    const g = track(new Game(mk(2), { timings: T })); g.start();
    const a = g.active, b = g.players.find(p => p.id !== a.id);
    a.coins = 14; b.coins = 10;
    g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
    assert.equal(a.coins, 7);
    assert.equal(g.pending.window.kind, 'lose_card'); assert.equal(g.pending.window.data.canPay, true);
    g.decide(b.id, { pay: true });
    assert.equal(b.coins, 1); assert.equal(b.cards.length, 3);
    g.declareAction(b.id, { type: 'income' });
    g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
    assert.equal(g.pending.window.data.canPay, false);
    g.decide(b.id, { index: 2 });
    assert.equal(b.cards.length, 2);
    g.destroy();
  });

  await test('colonel: correct guess removes exact card; wrong guess costs random card and pays target (capped)', async () => {
    const g = track(new Game(mk(2), { timings: T })); g.start();
    const a = g.active, b = g.players.find(p => p.id !== a.id);
    a.coins = 14; b.coins = 12; giveCard(g, a.id, 'colonel'); giveCard(g, b.id, 'thief');
    g.declareAction(a.id, { type: 'colonel', targetId: b.id, guess: 'thief' });
    g.pass(b.id);
    assert.equal(b.cards.length, 2); assert.equal(a.coins, 10);
    g.declareAction(b.id, { type: 'income' });
    withoutCard(g, b.id, 'politician');
    g.declareAction(a.id, { type: 'colonel', targetId: b.id, guess: 'politician' });
    g.pass(b.id);
    assert.equal(a.cards.length, 2); assert.equal(b.coins, MAX_COINS); assert.equal(a.coins, 6);
    g.destroy();
  });

  await test('business woman with reactive tax man; thief steal; tax man wealth tax', async () => {
    const g = track(new Game(mk(3), { timings: T })); g.start();
    const a = g.active; const [b, c] = g.players.filter(p => p.id !== a.id);
    giveCard(g, a.id, 'businesswoman'); giveCard(g, b.id, 'taxman');
    giveCard(g, c.id, 'taxman');
    g.declareAction(a.id, { type: 'businesswoman' });
    assert.equal(g.pending.window.block.kind, 'tax'); assert.ok(g.pending.window.claim);
    g.block(b.id);                 // b takes 1 as Tax Man
    g.pass(a.id); g.pass(c.id);    // nobody challenges b
    assert.equal(g.pending.window.block.kind, 'tax'); assert.deepEqual(g.pending.window.blockEligible, [c.id], 'c may still tax');
    g.block(c.id);                 // c takes 1 too
    g.pass(a.id); g.pass(b.id);
    assert.equal(a.coins, 4); assert.equal(b.coins, 3); assert.equal(c.coins, 3); // BW nets 2, both taxers +1
    // b's turn (turn order a->b->c? not guaranteed) – just act with whoever is active
    const who = g.active;
    const victim = g.players.find(p => p.id !== who.id && p.coins > 0);
    giveCard(g, who.id, 'thief');
    g.declareAction(who.id, { type: 'thief', targetId: victim.id });
    const before = victim.coins, mine = who.coins;
    for (const p of g.players) if (p.id !== who.id) g.pass(p.id); // single reaction window
    assert.equal(victim.coins, before - 2); assert.equal(who.coins, mine + 2);
    // wealth tax
    const t = g.active; const rich = g.players.find(p => p.id !== t.id); rich.coins = 9;
    giveCard(g, t.id, 'taxman');
    g.declareAction(t.id, { type: 'taxman', targetId: rich.id });
    for (const p of g.players) if (p.id !== t.id) g.pass(p.id);
    assert.equal(rich.coins, 8);
    g.destroy();
  });

  await test('police: look and swap; politician swaps all', async () => {
    const g = track(new Game(mk(2), { timings: T })); g.start();
    const a = g.active, b = g.players.find(p => p.id !== a.id);
    giveCard(g, a.id, 'police');
    g.declareAction(a.id, { type: 'police', targetId: b.id, slot: 1 });
    g.pass(b.id); // one reaction window (bluff call + block)
    const w = g.pending.window; assert.equal(w.kind, 'police'); assert.equal(w.data.card, b.cards[1]);
    assert.equal(g.viewFor(b.id).pending.window.data, undefined, 'peek is private');
    const front = g.deck.toArray()[0];
    g.decide(a.id, { swap: true });
    assert.equal(b.cards[1], front);
    giveCard(g, b.id, 'politician');
    const old = b.cards.slice();
    g.declareAction(b.id, { type: 'politician' });
    g.pass(a.id);
    assert.equal(b.cards.length, 3); assert.notDeepEqual(b.cards, old);
    assert.equal(g.deck.length + 6, 21);
    g.destroy();
  });

  await test('elimination & win; disconnected player auto-skips', async () => {
    const g = track(new Game(mk(2), { timings: T })); g.start();
    const a = g.active, b = g.players.find(p => p.id !== a.id);
    a.coins = 14; b.coins = 5; b.cards = b.cards.slice(0, 1); // b on last card (test shortcut)
    g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
    assert.equal(g.phase, 'ended'); assert.equal(g.winnerId, a.id);
    assert.equal(a.coins, 12, 'killer receives the victim coins (7 + 5)'); assert.equal(b.coins, 0);
    g.destroy();
    // bounty via a lost bluff call, capped at 14
    const g3 = track(new Game(mk(3), { timings: T })); g3.start();
    const x = g3.active; const [y] = g3.players.filter(p => p.id !== x.id);
    x.coins = 13; y.coins = 6; y.cards = y.cards.slice(0, 1); giveCard(g3, x.id, 'politician');
    g3.declareAction(x.id, { type: 'politician' });
    g3.challenge(y.id); // y wrongly calls the bluff with their last card
    assert.equal(y.alive, false); assert.equal(x.coins, 14, 'capped'); assert.equal(y.coins, 0);
    g3.destroy();
    const g2 = track(new Game(mk(3), { timings: T })); g2.start();
    const act = g2.active; g2.setConnected(act.id, false);
    await sleep(60);
    assert.notEqual(g2.active.id, act.id); assert.equal(act.coins, 3);
    g2.destroy();
  });

  await test('readable pauses: turn-end and bluff-call results show a result window before continuing', async () => {
    const g = track(new Game(mk(2), { timings: { ...T, turnPause: 60, resultPause: 60 } })); g.start();
    const a = g.active, b = g.players.find(p => p.id !== a.id);
    g.declareAction(a.id, { type: 'income' });
    assert.equal(g.pending.window.type, 'result'); assert.equal(g.pending.window.kind, 'turn_end'); assert.equal(g.active.id, a.id, 'turn has not changed yet');
    assert.equal(g.viewFor(b.id).pending.window.type, 'result');
    await sleep(90);
    assert.equal(g.active.id, b.id, 'turn advanced after the pause');
    giveCard(g, b.id, 'politician');
    g.declareAction(b.id, { type: 'politician' });
    g.challenge(a.id); // wrong call → result pause with verdict
    assert.equal(g.pending.window.type, 'result'); assert.equal(g.pending.window.kind, 'challenge'); assert.equal(g.pending.window.data.result, 'true');
    assert.equal(g.viewFor(a.id).pending.window.data.result, 'true');
    await sleep(90);
    // politician resolved after the pause, then turn-end pause
    assert.equal(g.pending.window.type, 'result'); assert.equal(g.pending.window.kind, 'turn_end');
    g.destroy();
  });

  await test('full random game always terminates with a winner and conserves cards', async () => {
    for (let run = 0; run < 20; run++) {
      const n = 2 + (run % 5);
      const g = track(new Game(mk(n), { timings: { ...T, turn: 20, decision: 15, challenge: 15, block: 15 } }));
      g.start();
      const tick = setInterval(() => {
        if (g.phase !== 'playing') return;
        const p = g.pending; if (!p) return;
        try {
          if (p.stage === 'turn' && Math.random() < 0.8) {
            const a = g.player(p.actorId); const others = g.alivePlayers().filter(x => x.id !== a.id);
            const t = others[Math.floor(Math.random() * others.length)];
            const opts = [{ type: 'income' }, { type: 'loan' }, { type: 'businesswoman' }, { type: 'politician' }, { type: 'police', targetId: t.id, slot: 0 }, { type: 'thief', targetId: t.id }];
            if (a.coins >= 7) opts.push({ type: 'paidkill', targetId: t.id });
            if (a.coins >= 3) opts.push({ type: 'terrorist', targetId: t.id });
            if (a.coins >= 4) opts.push({ type: 'colonel', targetId: t.id, guess: CHARACTERS[Math.floor(Math.random() * 7)] });
            if (t.coins > 7) opts.push({ type: 'taxman', targetId: t.id });
            const o = opts[Math.floor(Math.random() * opts.length)];
            if (o.type === 'thief' && t.coins === 0) return;
            g.declareAction(a.id, o);
          } else if (p.window && p.window.type === 'reaction' && p.window.claim && Math.random() < 0.5) {
            const e = p.window.challengeEligible; g.challenge(e[Math.floor(Math.random() * e.length)]);
          } else if (p.window && p.window.type === 'reaction' && p.window.block && Math.random() < 0.4) {
            const e = p.window.blockEligible; if (e.length) g.block(e[Math.floor(Math.random() * e.length)]);
          } else if (p.window && p.window.type === 'decision' && Math.random() < 0.7) {
            const pl = g.player(p.window.playerId);
            g.decide(pl.id, Math.random() < 0.5 && p.window.data.canPay ? { pay: true } : (p.window.kind === 'police' ? { swap: true } : { index: Math.floor(Math.random() * pl.cards.length) }));
          }
        } catch (e) { clearInterval(tick); throw e; }
      }, 5);
      const start = Date.now();
      while (g.phase === 'playing' && Date.now() - start < 20000) await sleep(20);
      clearInterval(tick);
      assert.equal(g.phase, 'ended', `game ${run} did not end`);
      const all = [...g.deck.toArray(), ...g.players.flatMap(p => p.cards)];
      assert.equal(all.length, 21);
      for (const c of CHARACTERS) assert.equal(all.filter(x => x === c).length, 3);
      assert.ok(g.players.every(p => p.coins <= MAX_COINS && p.coins >= 0));
      g.destroy();
    }
  });

  for (const g of live) g.destroy();
  console.log(`\n${passed} test group(s) passed${process.exitCode ? ' (with failures)' : ''}`);
})();
