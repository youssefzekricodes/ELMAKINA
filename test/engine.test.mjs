// Engine scenario tests (serverless engine: fake clock + tick()). Run: node test/engine.test.mjs
import assert from 'node:assert';
import { Game, Queue, CHARACTERS, MAX_COINS, ACTION_GRACE, DEFAULT_TIMINGS, standings, trophyDelta } from '../supabase/functions/game/engine.mjs';

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
/** N distinct random card indices from a hand — what a lose_card decision expects. */
function pickN(pl, n) { const idx = []; while (idx.length < Math.min(n, pl.cards.length)) { const r = Math.floor(Math.random() * pl.cards.length); if (!idx.includes(r)) idx.push(r); } return idx; }
/** Round-trip through JSON the way the edge function does between requests. */
const reload = (g) => Game.fromJSON(JSON.parse(JSON.stringify(g.toJSON())), { now: clock });
/** The only lose_card decision left is the Paid Kill buy-out. Decline it if one is open; which
    card goes is random and never asked. Returns true if a prompt was answered. */
function declineBuyout(g) {
  const w = g.pending && g.pending.window;
  if (!(w && w.type === 'decision' && w.kind === 'lose_card')) return false;
  g.decide(w.playerId, {});
  return true;
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
  // no prompt: the card goes at random the moment the turn settles
  assert.equal(g.pending && g.pending.window && g.pending.window.kind, undefined, 'nobody is asked which card');
  assert.equal(c.cards.length, cCards - 1);
  assert.equal(a.coins, 2); assert.ok(v.cards.length === 3);
});

await test('bluff caught: claimer loses a card and action fails; terrorist cost not refunded', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 5; withoutCard(g, a.id, 'terrorist');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  assert.equal(a.coins, 2);
  g.challenge(b.id);
  assert.equal(a.cards.length, 2); assert.equal(b.cards.length, 3); assert.equal(g.active.id, b.id);
});

await test('terrorist special case: a double hit takes two cards, both at random', () => {
  let g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 5; giveCard(g, a.id, 'terrorist');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  g.challenge(b.id);
  // The failed challenge costs a card THERE AND THEN, next to the reveal that caused it — not at
  // the end of the turn, by which point nobody can tell what the card was paid for.
  assert.equal(b.cards.length, 3 - 1, 'the wrong call is paid on the spot');
  assert.equal(g.pending.window.type, 'reaction'); assert.ok(!g.pending.window.claim && g.pending.window.block, 'b may still block with Colonel, claim proven');
  g = reload(g);
  g.pass(b.id);
  const w = g.pending.window;
  assert.equal(w, null, 'no prompt: nobody picks which cards go');
  assert.equal(g.player(b.id).cards.length, 1, 'failed challenge + the hit, both taken');
  assert.equal(g.phase, 'playing');
});

await test('a player who owes their whole hand is eliminated without being asked to choose', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 5; giveCard(g, a.id, 'terrorist'); b.cards = b.cards.slice(0, 2);
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  g.challenge(b.id);                                 // the wrong call costs one of two, immediately
  assert.equal(b.alive, true); assert.equal(b.cards.length, 1, 'paid at once; the block is still open');
  g.pass(b.id);                                      // the hit lands on the last card → out, no pointless pick
  assert.equal(b.alive, false); assert.equal(g.phase, 'ended'); assert.equal(g.winnerId, a.id);
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
  assert.equal(b.cards.length, 1, 'the failed block and the kill it let through both landed');
});

await test('anyone may counter: a non-target blocks the Terrorist with Colonel', () => {
  const g = newGame(3); g.start();
  const a = g.active; const [b, c] = g.players.filter((p) => p.id !== a.id);
  a.coins = 5; giveCard(g, a.id, 'terrorist'); giveCard(g, c.id, 'colonel');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  assert.deepEqual([...g.pending.window.blockEligible].sort(), [b.id, c.id].sort());
  g.block(c.id); g.challenge(a.id);
  assert.equal(a.cards.length, 2); assert.equal(b.cards.length, 3); assert.equal(c.cards.length, 3); assert.notEqual(g.active.id, a.id);
});

await test('paid kill: the buy-out is still a choice; the card itself is not', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 14; b.coins = 10;
  g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
  assert.equal(a.coins, 7); assert.equal(g.pending.window.kind, 'lose_card'); assert.equal(g.pending.window.data.canPay, true);
  g.decide(b.id, { pay: true });
  assert.equal(b.coins, 1); assert.equal(b.cards.length, 3);
  g.declareAction(b.id, { type: 'income' });
  g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
  // too poor to buy out → no prompt at all, a random card is simply gone
  assert.equal(g.pending && g.pending.window && g.pending.window.kind, undefined);
  assert.equal(b.cards.length, 2);
});

await test('colonel: correct guess removes exact card; wrong guess only costs the 4 coins, paid to the target (capped)', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 14; b.coins = 12; giveCard(g, a.id, 'colonel'); giveCard(g, b.id, 'thief');
  g.declareAction(a.id, { type: 'colonel', targetId: b.id, guess: 'thief' }); g.pass(b.id);
  assert.equal(b.cards.length, 2); assert.equal(a.coins, 10);
  assert.ok(g.events.some((e) => e.type === 'guess' && e.playerId === a.id && e.targetId === b.id && e.character === 'thief' && e.right === true), 'guess event for the client animation');
  g.declareAction(b.id, { type: 'income' });
  withoutCard(g, b.id, 'politician');
  const handBefore = a.cards.slice(), deckBefore = g.deck.length;
  g.declareAction(a.id, { type: 'colonel', targetId: b.id, guess: 'politician' }); g.pass(b.id);
  assert.deepEqual(a.cards, handBefore, 'a wrong guess never costs the actor a card');
  assert.equal(g.deck.length, deckBefore, 'and nothing goes back to the deck');
  assert.ok(!g.log.some((e) => e.key === 'card.lost' && e.params.reason === 'wrong_guess'), 'no card-loss line for a wrong guess');
  assert.equal(b.coins, MAX_COINS, 'the target still receives the 4 coins, capped'); assert.equal(a.coins, 6);
  assert.ok(g.log.some((e) => e.key === 'colonel.wrong' && !/loses a random card/.test(e.text)), 'the log no longer threatens a card');
  assert.ok(g.events.some((e) => e.type === 'guess' && e.playerId === a.id && e.targetId === b.id && e.character === 'politician' && e.right === false), 'wrong guesses are announced too');
  // the turn still ends normally and play carries on (turnPause is 0 in the test timings)
  assert.equal(g.phase, 'playing');
  assert.equal(g.active.id, b.id, 'turn passed to the next player');
  assert.equal(g.pending.stage, 'turn'); assert.ok(g.deadline != null, 'the next turn is on the clock');
});

await test('colonel: a wrong guess never eliminates the actor, even on their last card', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 5; while (a.cards.length > 1) g.deck.push(a.cards.pop());
  giveCard(g, a.id, 'colonel'); withoutCard(g, b.id, 'thief');
  g.declareAction(a.id, { type: 'colonel', targetId: b.id, guess: 'thief' }); g.pass(b.id);
  assert.equal(a.cards.length, 1, 'still holding their last card'); assert.equal(a.alive, true);
  assert.equal(g.phase, 'playing'); assert.equal(a.coins, 1);
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
  assert.equal(a.cards.length, 2); assert.equal(a.coins, 2, 'no payout'); assert.notEqual(g.active.id, a.id);
  // proven BW: after a true challenge the claim is gone from later windows
  g = newGame(3); g.start();
  const x = g.active; const [y, z] = g.players.filter((p) => p.id !== x.id);
  giveCard(g, x.id, 'businesswoman'); giveCard(g, y.id, 'taxman');
  g.declareAction(x.id, { type: 'businesswoman' });
  g.challenge(z.id);                   // wrong call → z loses a card at random, BW proven; collection reopens
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
  g.challengeTarget(a.id, c.id);                  // caught bluffing → c owes a card, skim voided; window reopens
  assert.equal(g.pending.window.bwMulti, true); assert.equal(g.pending.window.targets.length, 2, 'c resolved, b & d remain');
  g.challengeTarget(a.id, d.id);                  // caught → d owes one too
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
  assert.equal(g.nextDue(), NOW + 60); // a result pause waits for nobody, so it carries no grace
  advance(g, 90);
  assert.equal(g.active.id, b.id, 'turn advanced after the pause');
  giveCard(g, b.id, 'politician');
  g.declareAction(b.id, { type: 'politician' }); g.challenge(a.id);
  assert.equal(g.pending.window.type, 'result'); assert.equal(g.pending.window.kind, 'challenge'); assert.equal(g.pending.window.data.result, 'true');
  assert.equal(g.nextDue(), NOW + 60);
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
          g.decide(pl.id, Math.random() < 0.5 && p.window.data.canPay ? { pay: true } : (p.window.kind === 'police' ? { swap: true } : { indices: pickN(pl, p.window.data.count || 1) }));
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

await test('random games survive players walking out at any moment (no hangs, cards conserved)', () => {
  for (let run = 0; run < 20; run++) {
    const n = 3 + (run % 4);
    let g = new Game(mk(n), { timings: { ...T, turn: 20, decision: 15, challenge: 15, block: 15 }, now: clock });
    g.start();
    let steps = 0, quit = 0;
    while (g.phase === 'playing' && steps++ < 20000) {
      if (steps % 11 === 0) g = reload(g);
      if (quit < n - 1 && Math.random() < 0.01) { // somebody rage-quits mid-window
        const alive = g.alivePlayers();
        if (alive.length > 1) { g.forfeit(alive[Math.floor(Math.random() * alive.length)].id); quit++; continue; }
      }
      const p = g.pending;
      if (p) {
        if (p.stage === 'turn' && Math.random() < 0.8) {
          const a = g.player(p.actorId); const others = g.alivePlayers().filter((x) => x.id !== a.id);
          const t = others[Math.floor(Math.random() * others.length)];
          if (t) {
            const opts = [{ type: 'income' }, { type: 'loan' }, { type: 'businesswoman' }, { type: 'politician' }, { type: 'police', targetId: t.id, slot: 0 }];
            if (a.coins >= 7) opts.push({ type: 'paidkill', targetId: t.id });
            if (a.coins >= 3) opts.push({ type: 'terrorist', targetId: t.id });
            if (a.coins >= 4) opts.push({ type: 'colonel', targetId: t.id, guess: CHARACTERS[Math.floor(Math.random() * 7)] });
            g.declareAction(a.id, opts[Math.floor(Math.random() * opts.length)]);
          }
        } else if (p.window && p.window.type === 'reaction' && p.window.claim && Math.random() < 0.4) {
          const e = p.window.challengeEligible; if (e.length) g.challenge(e[Math.floor(Math.random() * e.length)]);
        } else if (p.window && p.window.type === 'decision' && Math.random() < 0.7) {
          const pl = g.player(p.window.playerId);
          if (pl.cards.length) g.decide(pl.id, p.window.kind === 'police' ? { swap: true } : { indices: pickN(pl, p.window.data.count || 1) });
        }
      }
      advance(g, 5);
    }
    assert.equal(g.phase, 'ended', `game ${run} did not end (${quit} walkouts)`);
    const all = [...g.deck.toArray(), ...g.players.flatMap((p) => p.cards)];
    assert.equal(all.length, 21, 'cards conserved despite walkouts');
    for (const c of CHARACTERS) assert.equal(all.filter((x) => x === c).length, 3);
  }
});

await test('reaction windows last 12s (block + challenge) and still time out', () => {
  assert.equal(DEFAULT_TIMINGS.block, 12000); assert.equal(DEFAULT_TIMINGS.challenge, 12000);
  const g = new Game(mk(3), { now: clock }); // real timings, not the fast test ones
  g.start();
  const a = g.active;
  g.declareAction(a.id, { type: 'loan' });                       // block-only window (Tax Man veto)
  assert.equal(g.pending.window.type, 'reaction'); assert.equal(g.pending.window.block.kind, 'veto');
  assert.equal(g.pending.window.deadline, NOW + 12000, '12s to veto');
  advance(g, 11000); assert.equal(g.pending.window.type, 'reaction', 'still open at 11s');
  advance(g, 1100);
  assert.equal(g.player(a.id).coins, 4, 'loan paid out when the 12s window expired');
  advance(g, DEFAULT_TIMINGS.turnPause + 100);                   // let the turn-end pause finish
  const b = g.active;
  g.declareAction(b.id, { type: 'politician' });                 // challenge-only window
  assert.equal(g.pending.window.type, 'reaction'); assert.ok(g.pending.window.claim);
  assert.equal(g.pending.window.deadline, NOW + 12000, '12s to call the bluff');
  advance(g, 11000); assert.ok(g.pending.window.claim, 'still challengeable at 11s');
  advance(g, 1100);
  assert.ok(g.log.some((e) => e.key === 'politician.swap'), 'claim resolved after the 12s window');
  // a room may widen or narrow those two windows; everything else keeps its default
  const slow = new Game(mk(3), { timings: { challenge: 30000, block: 30000 }, now: clock });
  assert.equal(slow.T.challenge, 30000); assert.equal(slow.T.block, 30000);
  assert.equal(slow.T.turn, DEFAULT_TIMINGS.turn); assert.equal(slow.T.decision, DEFAULT_TIMINGS.decision);
  assert.equal(slow.viewFor('p0').timings.challenge, 30000, 'clients read the window length from the view');
});

await test('forfeit: leaving mid-game eliminates the player and the game moves on', () => {
  const cards = (g) => g.deck.length + g.players.reduce((n, p) => n + p.cards.length, 0);
  // (a) the active player walks out → their cards go back and the turn moves on
  let g = newGame(3); g.start();
  let a = g.active;
  assert.equal(g.forfeit(a.id), true);
  assert.equal(g.player(a.id).alive, false); assert.equal(g.player(a.id).cards.length, 0);
  assert.equal(cards(g), 21, 'every card returned to the deck');
  assert.ok(g.outOrder.includes(a.id), 'finish order recorded for trophies/standings');
  assert.ok(g.events.some((e) => e.type === 'eliminated' && e.playerId === a.id));
  assert.ok(g.log.some((e) => e.key === 'elim.left'));
  assert.equal(g.phase, 'playing');
  assert.notEqual(g.active.id, a.id, 'the turn advanced past the forfeiting player');
  assert.equal(g.pending.stage, 'turn'); assert.ok(g.deadline != null, 'the clock is running again');
  assert.equal(g.forfeit(a.id), false, 'forfeiting twice is a no-op');
  assert.deepEqual(reload(g).toJSON(), g.toJSON(), 'state still round-trips');

  // (b) a player inside a reaction window walks out → counts as a pass, nothing hangs
  g = newGame(3); g.start();
  a = g.active; const [b, c] = g.players.filter((p) => p.id !== a.id);
  a.coins = 5; giveCard(g, a.id, 'terrorist');
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  assert.equal(g.pending.window.type, 'reaction');
  g.forfeit(c.id);
  assert.equal(g.phase, 'playing');
  assert.equal(g.pending.window.type, 'reaction'); assert.ok(g.pending.window.passed.includes(c.id), 'treated as passed');
  const bHeld = b.cards.length;
  g.pass(b.id);
  assert.equal(b.cards.length, bHeld - 1, 'the kill went ahead — a random card is gone');
  assert.equal(cards(g), 21); assert.ok(g.deadline != null);

  // (c) the claimer walks out mid-window → the claim dies with them, the action fails
  g = newGame(3); g.start();
  a = g.active; const d = g.players.find((p) => p.id !== a.id);
  a.coins = 5;
  g.declareAction(a.id, { type: 'terrorist', targetId: d.id });
  g.forfeit(a.id);
  assert.equal(g.phase, 'playing');
  assert.equal(g.player(d.id).cards.length, 3, 'the kill never resolved');
  assert.ok(g.log.some((e) => e.key === 'action.fail'));
  assert.notEqual(g.active.id, a.id); assert.ok(g.deadline != null); assert.equal(cards(g), 21);

  // (d) the player owing a decision walks out → resolved exactly like a timeout.
  // The buy-out is the only lose_card prompt left, so f needs the 9 coins for one to exist at all.
  g = newGame(3); g.start();
  a = g.active; const f = g.players.find((p) => p.id !== a.id);
  a.coins = 7; f.coins = 10;
  g.declareAction(a.id, { type: 'paidkill', targetId: f.id });
  assert.equal(g.pending.window.type, 'decision'); assert.equal(g.pending.window.playerId, f.id);
  g.forfeit(f.id);
  assert.equal(g.player(f.id).alive, false); assert.equal(g.phase, 'playing');
  assert.ok(g.deadline != null, 'no hang after an abandoned decision'); assert.equal(cards(g), 21);

  // (e) forfeiting can end the game
  g = newGame(2); g.start();
  a = g.active; const last = g.players.find((p) => p.id !== a.id);
  g.forfeit(last.id);
  assert.equal(g.phase, 'ended'); assert.equal(g.winnerId, a.id);
  assert.ok(g.outOrder.includes(last.id)); assert.equal(cards(g), 21);
  assert.equal(g.forfeit(a.id), false, 'nothing to forfeit once the game is over');
});

await test('trophy scale pays by table size, not just by finishing last', () => {
  const row = (n) => Array.from({ length: n }, (_, i) => trophyDelta(i + 1, n));
  assert.deepEqual(row(2), [1, 0], 'a duel: winner +1, loser 0');
  assert.deepEqual(row(3), [2, 0, -1]);
  assert.deepEqual(row(4), [3, 1, 0, -1]);
  assert.deepEqual(row(6), [3, 1, 0, -1, -1, -1], 'everyone from 4th down loses one');
});

await test('standings rank the winner first, then survivors, then newest-out', () => {
  const g = newGame(4); g.start();
  const [a, b, c, d] = g.players;
  // c went out first, then b — so the finish is: winner a, survivor d, then b, then c.
  g.outOrder = [c.id, b.id];
  b.alive = false; c.alive = false;
  g.winnerId = a.id;
  const places = standings(g);
  assert.deepEqual(places.map((p) => p.id), [a.id, d.id, b.id, c.id], 'surviving longer ranks higher');
  assert.deepEqual(places.map((p) => p.rank), [1, 2, 3, 4]);
  assert.deepEqual(places.map((p) => p.delta), [3, 1, 0, -1]);
  assert.deepEqual(places.map((p) => p.win), [true, false, false, false]);
});

await test('standings ride along in the view once the game has ended', () => {
  const g = newGame(2); g.start();
  const a = g.active, b = g.players.find((p) => p.id !== a.id);
  assert.equal(g.viewFor(a.id).standings, null, 'nothing to rank while the game is live');
  a.coins = 14; b.cards = b.cards.slice(0, 1);
  g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
  assert.equal(g.phase, 'ended');
  const v = g.viewFor(b.id).standings;
  assert.deepEqual(v.map((p) => [p.rank, p.delta]), [[1, 1], [2, 0]], 'a 2-player game pays +1 / 0');
  assert.equal(v[0].id, a.id);
});

await test('a game with a bot in it is worth no trophies at all', () => {
  const g = new Game([{ id: 'h', name: 'Human' }, { id: 'r', name: 'Robot', isBot: true }], { timings: T, now: clock });
  g.start();
  g.winnerId = 'h';
  const places = standings(g);
  assert.deepEqual(places.map((p) => p.isBot).sort(), [false, true], 'bots are flagged, not dropped');
  // room.mjs refuses to award anything when any place is a bot — see trophyAwards().
  assert.ok(places.some((p) => p.isBot), 'so solo wins cannot farm the leaderboard');
});

await test('swap fires wherever cards are exchanged, with how many moved', () => {
  const swaps = (g, from) => g.events.slice(from).filter((e) => e.type === 'swap');

  // politician trades the whole hand
  let g = newGame(2); g.start();
  let a = g.active, b = g.players.find((p) => p.id !== a.id);
  giveCard(g, a.id, 'politician');
  let from = g.events.length;
  g.declareAction(a.id, { type: 'politician' }); g.pass(b.id);
  assert.deepEqual(swaps(g, from).map((e) => [e.playerId, e.n]), [[a.id, 3]], 'three out, three in');

  // a proven claim replaces exactly the revealed card
  g = newGame(2); g.start();
  a = g.active; b = g.players.find((p) => p.id !== a.id);
  a.coins = 5; giveCard(g, a.id, 'terrorist');
  from = g.events.length;
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  g.challenge(b.id);
  assert.deepEqual(swaps(g, from).map((e) => [e.playerId, e.n]), [[a.id, 1]], 'the proven card goes back, one is drawn');

  // police taking the swap moves one card of the TARGET's
  g = newGame(2); g.start();
  a = g.active; b = g.players.find((p) => p.id !== a.id);
  giveCard(g, a.id, 'police');
  g.declareAction(a.id, { type: 'police', targetId: b.id, slot: 1 }); g.pass(b.id);
  from = g.events.length;
  g.decide(a.id, { swap: true });
  assert.deepEqual(swaps(g, from).map((e) => [e.playerId, e.n]), [[b.id, 1]]);

  // declining the swap moves nothing
  g = newGame(2); g.start();
  a = g.active; b = g.players.find((p) => p.id !== a.id);
  giveCard(g, a.id, 'police');
  g.declareAction(a.id, { type: 'police', targetId: b.id, slot: 0 }); g.pass(b.id);
  from = g.events.length;
  g.decide(a.id, { swap: false });
  assert.deepEqual(swaps(g, from), [], 'keeping the card is not a swap');
});

await test('a caught bluff costs the card immediately, not at the end of the turn', () => {
  const g = newGame(3); g.start();
  const a = g.active, [b, c] = g.players.filter((p) => p.id !== a.id);
  a.cards = ['taxman', 'taxman']; a.coins = 5;      // claiming Terrorist is a lie
  const from = g.events.length;
  g.declareAction(a.id, { type: 'terrorist', targetId: c.id });
  g.challenge(b.id);
  // the liar pays before anything else happens — the turn has not ended, nobody has moved on
  assert.equal(a.cards.length, 1, 'the card is gone the moment the bluff is exposed');
  assert.equal(g.owed.length, 0, 'and nothing is left owing');
  const fresh = g.events.slice(from);
  const bluffAt = fresh.findIndex((e) => e.type === 'bluff');
  const lostAt = fresh.findIndex((e) => e.type === 'card_lost' && e.playerId === a.id);
  assert.ok(bluffAt >= 0 && lostAt > bluffAt, 'and the table is told, right after the verdict');
  assert.equal(fresh[lostAt].reason, 'caught_bluffing');
  assert.equal(g.phase, 'playing', 'the turn is still resolving — this did not wait for it');
});

await test('a card loss names its weapon and its killer, so the cut-scene can retell it', () => {
  // Paid Kill: the attacker is on the event, and so is what they used.
  let g = newGame(2); g.start();
  let a = g.active, b = g.players.find((p) => p.id !== a.id);
  a.coins = 7; b.coins = 0; // no buy-out, so the card goes straight away
  let from = g.events.length;
  g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
  let lost = g.events.slice(from).find((e) => e.type === 'card_lost');
  assert.equal(lost.playerId, b.id);
  assert.equal(lost.killerId, a.id, 'who swung it');
  assert.equal(lost.reason, 'paidkill', 'what they swung');

  // Caught bluffing: the challenger is the killer, and the elimination carries the same pair.
  g = newGame(2); g.start();
  a = g.active; b = g.players.find((p) => p.id !== a.id);
  a.cards = ['taxman', 'taxman']; // claiming terrorist is a lie
  a.coins = 5;
  from = g.events.length;
  g.declareAction(a.id, { type: 'terrorist', targetId: b.id });
  g.challenge(b.id);
  lost = g.events.slice(from).find((e) => e.type === 'card_lost');
  assert.equal(lost.playerId, a.id);
  assert.equal(lost.killerId, b.id, 'the challenger did this');
  assert.equal(lost.reason, 'caught_bluffing');

  // The last card: elimination repeats the pair rather than making the client guess.
  g = newGame(2); g.start();
  a = g.active; b = g.players.find((p) => p.id !== a.id);
  a.coins = 7; b.coins = 0; b.cards = ['taxman'];
  from = g.events.length;
  g.declareAction(a.id, { type: 'paidkill', targetId: b.id });
  const out = g.events.slice(from).find((e) => e.type === 'eliminated');
  assert.equal(out.playerId, b.id);
  assert.equal(out.killerId, a.id);
  assert.equal(out.reason, 'paidkill');
});

console.log(`\n${passed} test group(s) passed${process.exitCode ? ' (with failures)' : ''}`);
