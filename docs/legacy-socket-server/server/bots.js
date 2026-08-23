'use strict';
/**
 * Server-side bots ("the machine") for solo play / filling seats.
 * A BotBrain watches a room's game; after every state change it schedules a decision for each bot
 * with a human-like delay. Bots only use the public engine API (declareAction / challenge / block /
 * pass / decide) with their own view, so they cannot cheat.
 */
const { GameError, CHARACTERS } = require('./game');

const BOT_NAMES = ['Machine·Hamza', 'Machine·Leila', 'Machine·Karim', 'Machine·Nour', 'Machine·Sami'];
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rnd(arr.length)];
// how valuable a card is to keep (higher = keep)
const VALUE = { terrorist: 6, colonel: 5, businesswoman: 4, taxman: 3, thief: 3, police: 2, politician: 1 };

class BotBrain {
  constructor(room) { this.room = room; this.timers = new Map(); this.last = {}; }
  reset() { for (const t of this.timers.values()) clearTimeout(t); this.timers.clear(); this.last = {}; }
  destroy() { this.reset(); }

  /** Called after every game update. */
  tick() {
    const g = this.room.game;
    if (!g || g.phase !== 'playing') return;
    for (const p of this.room.players) if (p.isBot) this.consider(p.id);
  }

  consider(botId) {
    const g = this.room.game;
    const v = g.viewFor(botId);
    const me = v.players.find(p => p.id === botId);
    if (!me || !me.alive || !v.pending) return;
    const pend = v.pending, w = pend.window;
    let key = null, fn = null, delay = 0;
    if (pend.stage === 'turn' && pend.actorId === botId) { key = 'turn:' + pend.deadline; fn = () => this.takeTurn(botId); delay = 2600 + rnd(2200); }
    else if (w && w.type === 'reaction') {
      if (!w.eligible.includes(botId) || w.passed.includes(botId)) return;
      key = `react:${w.deadline}:${w.claim ? w.claim.claimerId : ''}:${w.block ? w.block.kind : ''}`; fn = () => this.react(botId); delay = 3500 + rnd(3000);
    } else if (w && w.type === 'decision' && w.playerId === botId) { key = 'dec:' + w.deadline; fn = () => this.decide(botId); delay = 1800 + rnd(1800); }
    if (!key || this.last[botId] === key) return;
    this.last[botId] = key;
    const tk = botId + '|' + key;
    this.timers.set(tk, setTimeout(() => {
      this.timers.delete(tk);
      try { if (this.room.game === g && g.phase === 'playing') fn(); }
      catch (e) { if (!(e instanceof GameError)) console.error('[bot]', e); }
    }, delay));
  }

  takeTurn(botId) {
    const g = this.room.game, v = g.viewFor(botId);
    const me = v.players.find(p => p.id === botId), hand = v.you.cards;
    const others = v.players.filter(p => p.alive && p.id !== botId);
    if (!others.length) return;
    const has = (c) => hand.includes(c);
    const bluff = () => Math.random() < 0.22;
    const richest = others.slice().sort((a, b) => b.coins - a.coins)[0];
    const weakest = others.slice().sort((a, b) => a.cardCount - b.cardCount || b.coins - a.coins)[0];
    const attempt = (a) => { try { g.declareAction(botId, a); return true; } catch (e) { if (e instanceof GameError) return false; throw e; } };
    if (me.coins >= 7 && attempt({ type: 'paidkill', targetId: weakest.id })) return;
    if (me.coins >= 3 && (has('terrorist') || (me.coins >= 5 && bluff())) && attempt({ type: 'terrorist', targetId: weakest.id })) return;
    if (me.coins >= 4 && has('colonel') && Math.random() < 0.35) {
      // guess what they most likely hold: the character they claimed recently, else a random one
      const recent = (v.log || []).slice(-12).reverse().find(e => e.key && e.key.startsWith('claim.') && e.params && e.params.name === weakest.name);
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

  react(botId) {
    const g = this.room.game, v = g.viewFor(botId);
    const w = v.pending && v.pending.window; if (!w || w.type !== 'reaction') return;
    const hand = v.you.cards, action = v.pending.action || {};
    const targetedAtMe = action.targetId === botId;
    if (w.block && w.blockEligible.includes(botId)) {
      const ch = w.block.character;
      if (hand.includes(ch) && (w.block.kind !== 'block' || targetedAtMe || Math.random() < 0.45)) return g.block(botId);
      if (w.block.kind === 'block' && targetedAtMe && Math.random() < 0.15) return g.block(botId); // bluff a block when attacked
      if (w.block.kind === 'tax' && Math.random() < 0.08) return g.block(botId);
    }
    if (w.claim && w.challengeEligible.includes(botId)) {
      const ch = w.claim.character;
      const copies = hand.filter(c => c === ch).length;
      let p = copies >= 3 ? 1 : copies === 2 ? 0.6 : copies === 1 ? 0.18 : 0.11;
      if (targetedAtMe && w.claim.kind === 'action') p += 0.15;
      if (v.you.cards.length === 1) p -= 0.06; // careful when on the last card
      if (Math.random() < p) return g.challenge(botId);
    }
    g.pass(botId);
  }

  decide(botId) {
    const g = this.room.game, v = g.viewFor(botId);
    const w = v.pending && v.pending.window; if (!w || w.type !== 'decision' || w.playerId !== botId) return;
    const hand = v.you.cards, me = v.players.find(p => p.id === botId);
    if (w.kind === 'lose_card') {
      if (w.data && w.data.canPay && me.coins >= 9 && (hand.length === 1 || me.coins >= 12)) return g.decide(botId, { pay: true });
      // lose a duplicate first, else the least valuable
      let idx = hand.findIndex((c, i) => hand.indexOf(c) !== i);
      if (idx < 0) { let best = 0; for (let i = 1; i < hand.length; i++) if ((VALUE[hand[i]] || 0) < (VALUE[hand[best]] || 0)) best = i; idx = best; }
      return g.decide(botId, { index: idx });
    }
    if (w.kind === 'police') {
      const card = w.data && w.data.card;
      const own = w.data && w.data.targetId === botId;
      const swap = own ? hand.filter(c => c === card).length > 1 || (VALUE[card] || 0) <= 2 : (VALUE[card] || 0) >= 4; // rob them of strong cards
      return g.decide(botId, { swap });
    }
  }
}

module.exports = { BotBrain, BOT_NAMES };
