/**
 * Bots ("the machine") — serverless edition.
 * No timers: `runBots(game, botIds, sched, now)` looks at each bot's opportunity (its own view only, so bots
 * cannot cheat), schedules a human-like delay in `sched` (persisted with the game) and acts once it is due.
 */
import { GameError, CHARACTERS } from './engine.mjs';

export const BOT_NAMES = ['Machine·Hamza', 'Machine·Leila', 'Machine·Karim', 'Machine·Nour', 'Machine·Sami'];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
const VALUE = { terrorist: 6, colonel: 5, businesswoman: 4, taxman: 3, thief: 3, police: 2, politician: 1 }; // how valuable a card is to keep

/** What (if anything) this bot could do right now: {key, kind, delay} */
export function botOpportunity(game, botId) {
  const v = game.viewFor(botId);
  const me = v.players.find((p) => p.id === botId);
  if (!me || !me.alive || !v.pending) return null;
  const pend = v.pending, w = pend.window;
  if (pend.stage === 'turn' && pend.actorId === botId) return { key: 'turn:' + pend.deadline, kind: 'turn', delay: 2600 + rnd(2200) };
  if (w && w.type === 'reaction') {
    if (!w.eligible.includes(botId) || w.passed.includes(botId)) return null;
    return { key: `react:${w.deadline}:${w.claim ? w.claim.claimerId : ''}:${w.block ? w.block.kind : ''}`, kind: 'react', delay: 3500 + rnd(3000) };
  }
  if (w && w.type === 'decision' && w.playerId === botId) return { key: 'dec:' + w.deadline, kind: 'decide', delay: 1800 + rnd(1800) };
  return null;
}

/**
 * Advance every bot. `sched` = { [botId]: {key, at, kind} } (mutated). Returns true if a bot acted.
 * Call repeatedly: acting may open new opportunities for other bots.
 */
export function runBots(game, botIds, sched, now) {
  let acted = false;
  for (let round = 0; round < 12; round++) {
    let progressed = false;
    for (const botId of botIds) {
      if (game.phase !== 'playing') return acted;
      const opp = botOpportunity(game, botId);
      if (!opp) { delete sched[botId]; continue; }
      const cur = sched[botId];
      if (!cur || cur.key !== opp.key) { sched[botId] = { key: opp.key, at: now + opp.delay, kind: opp.kind }; continue; }
      if (now < cur.at) continue;
      delete sched[botId];
      try { botAct(game, botId, cur.kind); acted = true; progressed = true; } catch (e) { if (!(e instanceof GameError)) throw e; }
    }
    if (!progressed) break;
  }
  return acted;
}
/** Earliest moment any bot wants to act (or null). */
export function botsNextDue(sched) { let m = null; for (const s of Object.values(sched)) if (s && (m === null || s.at < m)) m = s.at; return m; }

export function botAct(game, botId, kind) {
  if (kind === 'turn') return takeTurn(game, botId);
  if (kind === 'react') return react(game, botId);
  if (kind === 'decide') return decide(game, botId);
}

function takeTurn(g, botId) {
  const v = g.viewFor(botId);
  const me = v.players.find((p) => p.id === botId), hand = v.you.cards;
  const others = v.players.filter((p) => p.alive && p.id !== botId);
  if (!others.length) return;
  const has = (c) => hand.includes(c);
  const bluff = () => Math.random() < 0.22;
  const richest = others.slice().sort((a, b) => b.coins - a.coins)[0];
  const weakest = others.slice().sort((a, b) => a.cardCount - b.cardCount || b.coins - a.coins)[0];
  const attempt = (a) => { try { g.declareAction(botId, a); return true; } catch (e) { if (e instanceof GameError) return false; throw e; } };
  if (me.coins >= 7 && attempt({ type: 'paidkill', targetId: weakest.id })) return;
  if (me.coins >= 3 && (has('terrorist') || (me.coins >= 5 && bluff())) && attempt({ type: 'terrorist', targetId: weakest.id })) return;
  if (me.coins >= 4 && has('colonel') && Math.random() < 0.35) {
    const recent = (v.log || []).slice(-12).reverse().find((e) => e.key && e.key.startsWith('claim.') && e.params && e.params.name === weakest.name);
    const guess = recent && recent.key.split('.')[1] !== 'police' ? recent.key.split('.')[1] : pick(CHARACTERS);
    if (CHARACTERS.includes(guess) && attempt({ type: 'colonel', targetId: weakest.id, guess })) return;
  }
  if ((has('businesswoman') || bluff()) && attempt({ type: 'businesswoman' })) return;
  if ((has('thief') || bluff()) && richest.coins >= 2 && attempt({ type: 'thief', targetId: richest.id })) return;
  if ((has('taxman') || bluff()) && richest.coins > 7 && attempt({ type: 'taxman', targetId: richest.id })) return;
  if (has('police') && Math.random() < 0.3 && attempt({ type: 'police', targetId: weakest.id, slot: rnd(Math.max(1, weakest.cardCount)) })) return;
  if (has('politician') && Math.random() < 0.35 && attempt({ type: 'politician' })) return;
  if (Math.random() < 0.55 && attempt({ type: 'loan' })) return;
  attempt({ type: 'income' });
}

function react(g, botId) {
  const v = g.viewFor(botId);
  const w = v.pending && v.pending.window; if (!w || w.type !== 'reaction') return;
  const hand = v.you.cards, action = v.pending.action || {};
  const targetedAtMe = action.targetId === botId;
  if (w.bwMulti) { // anyone may call the bluff on a skimming Tax Man (never on your own skim), else pass
    const others = Array.isArray(w.targets) ? w.targets.filter((t) => t.id !== botId) : [];
    if (others.length && Math.random() < 0.28) {
      const t = others[rnd(others.length)];
      try { return g.challengeTarget(botId, t.id); } catch (e) { if (!(e instanceof GameError)) throw e; }
    }
    return g.pass(botId);
  }
  if (w.block && w.blockEligible.includes(botId)) {
    const ch = w.block.character;
    if (w.block.kind === 'tax') { // Business Woman skim: take it if we really hold a Tax Man, else rarely bluff
      if (hand.includes('taxman') && Math.random() < 0.7) return g.block(botId);
      if (Math.random() < 0.06) return g.block(botId);
    } else {
      if (hand.includes(ch) && (w.block.kind !== 'block' || targetedAtMe || Math.random() < 0.45)) return g.block(botId);
      if (w.block.kind === 'block' && targetedAtMe && Math.random() < 0.15) return g.block(botId); // bluff a block when attacked
    }
  }
  if (w.claim && w.challengeEligible.includes(botId)) {
    const ch = w.claim.character; const copies = hand.filter((c) => c === ch).length;
    let p = copies >= 3 ? 1 : copies === 2 ? 0.6 : copies === 1 ? 0.18 : 0.11;
    if (targetedAtMe && w.claim.kind === 'action') p += 0.15;
    if (v.you.cards.length === 1) p -= 0.06;
    if (Math.random() < p) return g.challenge(botId);
  }
  g.pass(botId);
}

function decide(g, botId) {
  const v = g.viewFor(botId);
  const w = v.pending && v.pending.window; if (!w || w.type !== 'decision' || w.playerId !== botId) return;
  const hand = v.you.cards, me = v.players.find((p) => p.id === botId);
  // The only question left is the Paid Kill buy-out; which card goes is random for bots too.
  if (w.kind === 'lose_card') {
    if (w.data && w.data.canPay && me.coins >= 9 && (hand.length === 1 || me.coins >= 12)) return g.decide(botId, { pay: true });
    return g.decide(botId, {});
  }
  if (w.kind === 'police') {
    const card = w.data && w.data.card; const own = w.data && w.data.targetId === botId;
    const swap = own ? hand.filter((c) => c === card).length > 1 || (VALUE[card] || 0) <= 2 : (VALUE[card] || 0) >= 4;
    return g.decide(botId, { swap });
  }
}
