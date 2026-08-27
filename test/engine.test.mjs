// Engine scenario tests (serverless engine: fake clock + tick()). Run: node test/engine.test.mjs
import assert from 'node:assert';
import { Game, Queue, CHARACTERS, MAX_COINS, ACTION_GRACE } from '../supabase/functions/game/engine.mjs';

const T = { challenge: 40, block: 40, decision: 40, turn: 200, disconnectedTurn: 30, disconnectedDecision: 20, resultPause: 0, turnPause: 0 };
let NOW = 1_000_000;
const clock = () => NOW;
const mk = (n) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const newGame = (n, timings = T) => new Game(mk(n), { timings, now: clock });
/** advance the fake clock and fire due work */
const advance = (g, ms) => { NOW += ms; g.tick(NOW); };
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('✓', name); }
  catch (e) { console.error('✗', name); console.error(e); process.exitCode = 1; }
}
function giveCard(g, pid, ch) {
  const p = g.player(pid);
  if (p.cards.includes(ch)) return;
  let deckArr = g.deck.toArray();
  if (!deckArr.includes(ch)) { const holder = g.players.find((x) => x.id !== pid && x.cards.includes(ch)); const j = holder.cards.indexOf(ch); holder.cards[j] = deckArr.shift(); deckArr.push(ch); }
  const i = deckArr.indexOf(ch);
  g.deck = new Queue(deckArr.filter((_, k) => k !== i)); g.deck.push(p.cards.pop()); p.cards.push(ch);
}
function withoutCard(g, pid, ch) { const p = g.player(pid); while (p.cards.includes(ch)) { const i = p.cards.indexOf(ch); const other = g.deck.toArray().find((c) => c !== ch); const arr = g.deck.toArray(); arr.splice(arr.indexOf(other), 1); g.deck = new Queue(arr); g.deck.push(p.cards[i]); p.cards[i] = other; } }
/** Round-trip through JSON the way the edge function does between requests. */
const reload = (g) => Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())), { now: clock });
/** Challenge losses now open a lose_card decision (loser chooses). Answer it; returns the card that was lost. */
function settleLoss(g, index = 0) {
  const w = g.pending && g.pending.window;
  if (!(w && w.type === 'decision' && w.kind === 'lose_card')) return null;
  const loser = g.player(w.playerId); const chosen = loser.cards[Math.min(index, loser.cards.length - 1)];
  g.decide(w.playerId, { index: Math.min(index, loser.cards.length - 1) });
  return chosen;
}

await test('Queue is FIFO', () => {
  const q = new Queue(['a', 'b', 'c']);
  assert.equal(q.shift(), 'a'); q.push('a'); assert.deepEqual(q.toArray(), ['b', 'c', 'a']); assert.equal(q.length, 3);
});

await test('setup: 21 cards, hand sizes, coins, total conservation', () => {
  for (const n of [2, 4, 5, 6]) {
    const g = newGame(n); const hand = n <= 4 ? 3 : 2;
    assert.ok(g.players.every((p) => p.cards.length === hand && p.coins === 2));
    assert.equal(g.deck.length + n * hand, 21);
    const all = [...g.deck.toArray(), ...g.players.flatMap((p) => p.cards)];
    for (const c of CHARACTERS) assert.equal(all.filter((x) => x === c).length, 3);
  }
});

await test('view never leaks other hands; state JSON round-trips', () => {
  const g = newGame(3); g.start();
  const v = g.viewFor('p0');
  assert.ok(v.you.cards.length === 3);
  assert.ok(v.players.every((p) => !('cards' in p)));
  assert.ok(!JSON.stringify(v).includes('"deck"'));
  const g2 = reload(g);
  assert.deepEqual(g2.toJSON(), g.toJSON());
  assert.equal(g2.active.id, g.active.id);
});

await test('income, loan (no veto), coin cap at 14', () => {
  let g = newGame(2); g.start();
  const a = g.active;
  g.declareAction(a.id, { type: 'income' });
  assert.equal(a.coins, 3);
  const bId = g.active.id; assert.notEqual(bId, a.id);
  g.declareAction(bId, { type: 'loan' });
  assert.equal(g.pending.window.type, 'reaction'); assert.equal(g.pending.window.block.kind, 'veto');
  g = reload(g); advance(g, 60); // window times out after a reload
  assert.equal(g.player(bId).coins, 4);
  g.player(bId).coins = 13;
  g.declareAction(g.active.id, { type: 'income' });
  g.declareAction(bId, { type: 'loan' }); g.pass(a.id);
  assert.equal(g.player(bId).coins, 14);
});

await test('loan veto: truthful tax man veto stops loan, challenger loses a card', () => {
  const g = newGame(3); g.start();
  const a = g.active; const others = g.players.filter((p) => p.id !== a.id); const v = others[0], c = others[1];
  giveCard(g, v.id, 'taxman');
  g.declareAction(a.id, { type: 'loan' });
  g.block(v.id);
  assert.equal(g.pending.window.type, 'reaction'); assert.ok(g.pending.window.claim && !g.pending.window.block);
  const cCards = c.cards.length;
  g.challenge(c.id);
  const cLost = settleLoss(g, 1);                    // challenger chooses which card to lose
  assert.equal(c.cards.length, cCards - 1); assert.ok(!c.cards.includes(cLost) || c.cards.filter((x) => x === cLost).length < cCards, 'the chosen card was lost');
  assert.equal(a.coins, 2); assert.ok(v.cards.length === 3);
});

await test('bluff caught: claimer loses a card and action fails; terrorist cost not refunded', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 5; withoutCard(g, a.id, 'terrorist');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  assert.equal(a.coins, 2);
  g.challenge(b.id);
  settleLoss(g);                                     // caught claimer chooses which card to lose
  assert.equal(a.cards.length, 2); assert.equal(b.cards.length, 3); assert.equal(g.active.id, b.id);
});

await test('terrorist special case: target challenges truthful terrorist, loses 2 cards; chooses which', () => {
  let g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 5; giveCard(g, a.id, 'terrorist');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  g.challenge(b.id);
  const bBefore = g.player(b.id).cards.slice();
  const bLost = settleLoss(g, 1);                    // b chooses the challenge loss too now
  assert.equal(bLost, bBefore[1], 'chosen index is the card lost');
  assert.equal(b.cards.length, 2, 'lost one from challenge'); assert.ok(a.cards.length === 3);
  assert.equal(g.pending.window.type, 'reaction'); assert.ok(!g.pending.window.claim && g.pending.window.block, 'b may still block with Colonel, claim proven');
  g = reload(g);
  g.pass(b.id);
  assert.equal(g.pending.window.type, 'decision'); assert.equal(g.pending.window.kind, 'lose_card');
  g.decide(b.id, { index: 0 });
  assert.equal(g.player(b.id).cards.length, 1); assert.equal(g.phase, 'playing');
});

await test('block with Colonel: successful block stops kill; lying block fails and kill proceeds', () => {
  const g = newGame(3); g.start();
  const a = g.active; const [b] = g.players.filter((p) => p.id !== a.id);
  a.coins = 10; giveCard(g, a.id, 'terrorist'); giveCard(g, b.id, 'colonel');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  assert.equal(g.pending.window.type, 'reaction'); assert.ok(g.pending.window.claim && g.pending.window.block.kind === 'block');
  g.block(b.id);
  advance(g, 60); // nobody challenges the block
  assert.equal(b.cards.length, 3); assert.notEqual(g.active.id, a.id);
  while (g.active.id !== a.id) g.declareAction(g.active.id, { type: 'income' });
  withoutCard(g, b.id, 'colonel');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  g.block(b.id);
  g.challenge(a.id);
  settleLoss(g);                                     // b chooses the challenge loss
  assert.equal(b.cards.length, 2); assert.equal(g.pending.window.type, 'decision');
  g.decide(b.id, { index: 1 });                      // ...then the kill's own choice
  assert.equal(b.cards.length, 1);
});

await test('anyone may counter: a non-target blocks the Terrorist with Colonel', () => {
  const g = newGame(3); g.start();
  const a = g.active; const [b, c] = g.players.filter((p) => p.id !== a.id);
  a.coins = 5; giveCard(g, a.id, 'terrorist'); giveCard(g, c.id, 'colonel');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  assert.deepEqual([...g.pending.window.blockEligible].sort(), [b.id, c.id].sort());
  g.block(c.id); g.challenge(a.id);
  settleLoss(g);                                     // failed challenger chooses
  assert.equal(a.cards.length, 2); assert.equal(b.cards.length, 3); assert.equal(c.cards.length, 3); assert.notEqual(g.active.id, a.id);
});

await test('paid kill: target can pay 9 to survive; otherwise chooses card', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 14; b.coins = 10;
  g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
  assert.equal(a.coins, 7); assert.equal(g.pending.window.kind, 'lose_card'); assert.equal(g.pending.window.data.canPay, true);
  g.decide(b.id, { pay: true });
  assert.equal(b.coins, 1); assert.equal(b.cards.length, 3);
  g.declareAction(b.id, { type: 'income' });
  g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
  assert.equal(g.pending.window.data.canPay, false);
  g.decide(b.id, { index: 2 });
  assert.equal(b.cards.length, 2);
});

await test('colonel: correct guess removes exact card; wrong guess costs random card and pays target (capped)', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 14; b.coins = 12; giveCard(g, a.id, 'colonel'); giveCard(g, b.id, 'thief');
  g.declareAction(a.id, { type: 'colonel', targetId: b.id, guess: 'thief' }); g.pass(b.id);
  assert.equal(b.cards.length, 2); assert.equal(a.coins, 10);
  g.declareAction(b.id, { type: 'income' });
  withoutCard(g, b.id, 'politician');
  g.declareAction(a.id, { type: 'colonel', targetId: b.id, guess: 'politician' }); g.pass(b.id);
  assert.equal(a.cards.length, 2); assert.equal(b.coins, MAX_COINS); assert.equal(a.coins, 6);
});

await test('business woman with reactive tax man; thief steal; tax man wealth tax', () => {
  let g = newGame(3); g.start();
  const a = g.active; const [b, c] = g.players.filter((p) => p.id !== a.id);
  giveCard(g, a.id, 'businesswoman'); giveCard(g, b.id, 'taxman'); giveCard(g, c.id, 'taxman');
  g.declareAction(a.id, { type: 'businesswoman' });
  assert.equal(g.pending.window.block.kind, 'tax'); assert.ok(g.pending.window.claim); // one shared collection window
  assert.equal(g.pending.window.multiTax, true);
  g.block(b.id);                 // b skims — the window stays open so others can skim too
  assert.equal(g.pending.window.multiTax, true, 'still collecting'); assert.deepEqual(g.pending.window.blockEligible, [c.id]);
  g = reload(g);
  g.block(c.id);                 // c skims too → everyone reacted → the BW may now call the bluff on each
  assert.equal(g.pending.window.bwMulti, true, 'BW multi-challenge window');
  assert.equal(g.pending.window.targets.length, 2, 'both Tax Men listed at once');
  assert.ok(g.pending.window.challengeEligible.includes(a.id), 'anyone alive may challenge a skim');
  for (const p of g.players) g.pass(p.id);   // nobody challenges → both keep the coin → payout
  assert.equal(g.player(a.id).coins, 4); assert.equal(g.player(b.id).coins, 3); assert.equal(g.player(c.id).coins, 3);
  const who = g.active; const victim = g.players.find((p) => p.id !== who.id && p.coins > 0);
  giveCard(g, who.id, 'thief');
  g.declareAction(who.id, { type: 'thief', targetId: victim.id });
  const before = victim.coins, mine = who.coins;
  for (const p of g.players) if (p.id !== who.id) g.pass(p.id);
  assert.equal(victim.coins, before - 2); assert.equal(who.coins, mine + 2);
  const t = g.active; const rich = g.players.find((p) => p.id !== t.id); rich.coins = 9;
  giveCard(g, t.id, 'taxman');
  g.declareAction(t.id, { type: 'taxman', targetId: rich.id });
  for (const p of g.players) if (p.id !== t.id) g.pass(p.id);
  assert.equal(rich.coins, 8);
});

await test('business woman: the BW claim can still be called after someone taxed; not after it was proven', () => {
  let g = newGame(3); g.start();
  const a = g.active; const [b, c] = g.players.filter((p) => p.id !== a.id);
  withoutCard(g, a.id, 'businesswoman'); giveCard(g, b.id, 'taxman');
  g.declareAction(a.id, { type: 'businesswoman' });
  g.block(b.id);                       // b skims — the collection window stays open, BW still callable
  const w = g.pending.window;
  assert.equal(w.type, 'reaction'); assert.ok(w.claim && w.claim.claimerId === a.id, 'the BW is still challengeable');
  assert.ok(w.challengeEligible.includes(c.id));
  g.challenge(c.id);                   // c calls the BW bluff — a was lying
  settleLoss(g);
  assert.equal(a.cards.length, 2); assert.equal(a.coins, 2, 'no payout'); assert.notEqual(g.active.id, a.id);
  // proven BW: after a true challenge the claim is gone from later windows
  g = newGame(3); g.start();
  const x = g.active; const [y, z] = g.players.filter((p) => p.id !== x.id);
  giveCard(g, x.id, 'businesswoman'); giveCard(g, y.id, 'taxman');
  g.declareAction(x.id, { type: 'businesswoman' });
  g.challenge(z.id);                   // wrong call → z loses a card (their choice), BW proven; collection reopens
  settleLoss(g);
  assert.equal(g.pending.window.type, 'reaction'); assert.equal(g.pending.window.claim, null, 'proven: only tax remains');
  g.block(y.id);                       // y skims → x may now call the bluff on y
  assert.ok(g.pending.window.challengeEligible.includes(x.id), 'anyone alive may challenge a skim');
  for (const p of g.players) g.pass(p.id);   // nobody challenges → payout
  assert.equal(g.player(x.id).coins, 5, 'x kept 3 of the 4 (2 + 3)'); assert.equal(g.player(y.id).coins, 3);
});

await test('business woman concurrent multi-challenge: call bluff on several Tax Men at once', () => {
  let g = newGame(4); g.start();
  const a = g.active; const [b, c, d] = g.players.filter((p) => p.id !== a.id);
  giveCard(g, a.id, 'businesswoman');
  giveCard(g, b.id, 'taxman');       // b truly holds Tax Man
  withoutCard(g, c.id, 'taxman');     // c bluffs
  withoutCard(g, d.id, 'taxman');     // d bluffs
  const bCards = b.cards.length, cCards = c.cards.length, dCards = d.cards.length;
  g.declareAction(a.id, { type: 'businesswoman' });
  g.block(b.id); g.block(c.id); g.block(d.id);   // all three skim → BW multi-challenge opens
  assert.equal(g.pending.window.bwMulti, true);
  assert.equal(g.pending.window.targets.length, 3, 'all three listed at once');
  g = reload(g);                                  // survives JSON round-trip
  const a2 = g.player(a.id);
  g.challengeTarget(a.id, c.id);                  // caught bluffing → c chooses a card to lose, skim voided; window reopens
  settleLoss(g);
  assert.equal(g.pending.window.bwMulti, true); assert.equal(g.pending.window.targets.length, 2, 'c resolved, b & d remain');
  g.challengeTarget(a.id, d.id);                  // caught → d chooses a card too
  settleLoss(g);
  assert.equal(g.pending.window.bwMulti, true); assert.equal(g.pending.window.targets.length, 1, 'only b remains');
  for (const p of g.players) g.pass(p.id);        // nobody challenges b → honest Tax Man keeps the coin → payout
  assert.equal(g.player(c.id).cards.length, cCards - 1, 'c lost a card');
  assert.equal(g.player(d.id).cards.length, dCards - 1, 'd lost a card');
  assert.equal(g.player(b.id).cards.length, bCards, 'honest b kept his cards');
  assert.equal(g.player(a.id).coins, 5, 'BW kept 3 of 4 (one taxer stood)');
  assert.equal(g.player(b.id).coins, 3, 'b kept his skim');
  assert.equal(g.player(c.id).coins, 2, 'voided skim'); assert.equal(g.player(d.id).coins, 2, 'voided skim');
});

await test('police: look and swap; politician swaps all', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  giveCard(g, a.id, 'police');
  g.declareAction(a.id, { type: 'police', targetId: b.id, slot: 1 }); g.pass(b.id);
  const w = g.pending.window; assert.equal(w.kind, 'police'); assert.equal(w.data.card, b.cards[1]);
  assert.equal(g.viewFor(b.id).pending.window.data, undefined, 'peek is private');
  const front = g.deck.toArray()[0];
  g.decide(a.id, { swap: true });
  assert.equal(b.cards[1], front);
  giveCard(g, b.id, 'politician');
  const old = b.cards.slice();
  g.declareAction(b.id, { type: 'politician' }); g.pass(a.id);
  assert.equal(b.cards.length, 3); assert.notDeepEqual(b.cards, old); assert.equal(g.deck.length + 6, 21);
});

await test('elimination & win; disconnected player auto-skips', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 14; b.coins = 5; b.cards = b.cards.slice(0, 1);
  g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
  assert.equal(g.phase, 'ended'); assert.equal(g.winnerId, a.id); assert.equal(a.coins, 12); assert.equal(b.coins, 0);
  const g3 = newGame(3); g3.start();
  const x = g3.active; const [y] = g3.players.filter((p) => p.id !== x.id);
  x.coins = 13; y.coins = 6; y.cards = y.cards.slice(0, 1); giveCard(g3, x.id, 'politician');
  g3.declareAction(x.id, { type: 'politician' }); g3.challenge(y.id);
  assert.equal(y.alive, false); assert.equal(x.coins, 14, 'capped'); assert.equal(y.coins, 0);
  const g2 = newGame(3); g2.start();
  const act = g2.active; g2.setConnected(act.id, false);
  advance(g2, 60);
  assert.notEqual(g2.active.id, act.id); assert.equal(act.coins, 3);
});

await test('readable pauses: turn-end and bluff-call results show a result window before continuing', () => {
  const g = newGame(2, { ...T, turnPause: 60, resultPause: 60 }); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  g.declareAction(a.id, { type: 'income' });
  assert.equal(g.pending.window.type, 'result'); assert.equal(g.pending.window.kind, 'turn_end'); assert.equal(g.active.id, a.id);
  assert.equal(g.viewFor(b.id).pending.window.type, 'result');
  assert.equal(g.nextDue(), NOW + 60 + ACTION_GRACE); // nextDue includes the late-move grace window
  advance(g, 90);
  assert.equal(g.active.id, b.id, 'turn advanced after the pause');
  giveCard(g, b.id, 'politician');
  g.declareAction(b.id, { type: 'politician' }); g.challenge(a.id);
  settleLoss(g);                                     // a chooses the challenge loss, then the result pause shows
  assert.equal(g.pending.window.type, 'result'); assert.equal(g.pending.window.kind, 'challenge'); assert.equal(g.pending.window.data.result, 'true');
  advance(g, 90);
  assert.equal(g.pending.window.type, 'result'); assert.equal(g.pending.window.kind, 'turn_end');
});

await test('full random game always terminates with a winner and conserves cards (with JSON reloads)', () => {
  for (let run = 0; run < 20; run++) {
    const n = 2 + (run % 5);
    let g = new Game(mk(n), { timings: { ...T, turn: 20, decision: 15, challenge: 15, block: 15 }, now: clock });
    g.start();
    let steps = 0;
    while (g.phase === 'playing' && steps++ < 20000) {
      if (steps % 7 === 0) g = reload(g);
      const p = g.pending;
      if (p) {
        if (p.stage === 'turn' && Math.random() < 0.8) {
          const a = g.player(p.actorId); const others = g.alivePlayers().filter((x) => x.id !== a.id);
          const t = others[Math.floor(Math.random() * others.length)];
          const opts = [{ type: 'income' }, { type: 'loan' }, { type: 'businesswoman' }, { type: 'politician' }, { type: 'police', targetId: t.id, slot: 0 }, { type: 'thief', targetId: t.id }];
          if (a.coins >= 7) opts.push({ type: 'paidkill', targetId: t.id });
          if (a.coins >= 3) opts.push({ type: 'terrorist', targetId: t.id });
          if (a.coins >= 4) opts.push({ type: 'colonel', targetId: t.id, guess: CHARACTERS[Math.floor(Math.random() * 7)] });
          if (t.coins > 7) opts.push({ type: 'taxman', targetId: t.id });
          const o = opts[Math.floor(Math.random() * opts.length)];
          if (!(o.type === 'thief' && t.coins === 0)) g.declareAction(a.id, o);
        } else if (p.window && p.window.type === 'reaction' && p.window.claim && Math.random() < 0.5) {
          const e = p.window.challengeEligible; g.challenge(e[Math.floor(Math.random() * e.length)]);
        } else if (p.window && p.window.type === 'reaction' && p.window.block && Math.random() < 0.4) {
          const e = p.window.blockEligible; if (e.length) g.block(e[Math.floor(Math.random() * e.length)]);
        } else if (p.window && p.window.type === 'decision' && Math.random() < 0.7) {
          const pl = g.player(p.window.playerId);
          g.decide(pl.id, Math.random() < 0.5 && p.window.data.canPay ? { pay: true } : (p.window.kind === 'police' ? { swap: true } : { index: Math.floor(Math.random() * pl.cards.length) }));
        }
      }
      advance(g, 5);
    }
    assert.equal(g.phase, 'ended', `game ${run} did not end`);
    const all = [...g.deck.toArray(), ...g.players.flatMap((p) => p.cards)];
    assert.equal(all.length, 21);
    for (const c of CHARACTERS) assert.equal(all.filter((x) => x === c).length, 3);
    assert.ok(g.players.every((p) => p.coins <= MAX_COINS && p.coins >= 0));
  }
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ' (with failures)' : ''}`);
