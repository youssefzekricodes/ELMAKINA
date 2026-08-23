'use strict';
/**
 * El-MEKINA — authoritative game engine.
 *
 * All hidden state (hands, FIFO deck, coins) lives here. The engine never
 * emits anything by itself: it calls `hooks.onUpdate()` whenever state
 * changes, and the transport layer builds a per-player view via `viewFor()`.
 *
 * Resolution order for every action:
 *   1. active player declares
 *   2. character claim  -> challenge window (any other player may challenge)
 *   3. blockable action -> block window (eligible player claims blocker; block is itself challengeable)
 *   4. resolve -> next turn
 */

const MSG = require('../shared/messages.js');
const CHARACTERS = ['taxman', 'businesswoman', 'police', 'terrorist', 'colonel', 'politician', 'thief'];
const CHAR_NAMES = {
  taxman: 'Tax Man',
  businesswoman: 'Business Woman',
  police: 'Police',
  terrorist: 'Terrorist',
  colonel: 'Colonel',
  politician: 'Politician',
  thief: 'Thief',
};
const COPIES = 3;
const MAX_COINS = 14;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;

// Character claimed by each character action
const ACTION_CHARACTER = {
  businesswoman: 'businesswoman',
  taxman: 'taxman',
  police: 'police',
  terrorist: 'terrorist',
  colonel: 'colonel',
  politician: 'politician',
  thief: 'thief',
};
const DEFAULT_ACTIONS = ['income', 'loan', 'paidkill'];

const DEFAULT_TIMINGS = {
  challenge: 12000,       // reaction window when a claim can be challenged
  block: 10000,           // counter-only window (veto / tax / block after a proven claim)
  decision: 20000,        // choose card to lose, pay to survive, police keep/swap
  resultPause: 3200,      // pause to show the outcome of a bluff call / block before continuing
  turnPause: 2200,        // pause at the end of a turn so everyone can read what happened
  turn: 60000,            // time for the active player to declare an action
  disconnectedTurn: 8000, // shortened turn timer when the active player is disconnected
  disconnectedDecision: 2500,
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A real FIFO queue: draw from the front, return to the back. */
class Queue {
  constructor(items = []) { this._items = items.slice(); this._head = 0; }
  get length() { return this._items.length - this._head; }
  /** Draw from the FRONT. */
  shift() {
    if (this.length === 0) throw new Error('Deck is empty');
    const v = this._items[this._head++];
    if (this._head > 64) { this._items = this._items.slice(this._head); this._head = 0; }
    return v;
  }
  /** Return to the BACK. */
  push(v) { this._items.push(v); }
  toArray() { return this._items.slice(this._head); }
}

class GameError extends Error {}

class Game {
  /**
   * @param {Array<{id:string,name:string,connected?:boolean}>} seatPlayers
   * @param {{onUpdate:Function, timings?:object}} hooks
   */
  constructor(seatPlayers, hooks = {}) {
    if (seatPlayers.length < MIN_PLAYERS || seatPlayers.length > MAX_PLAYERS) {
      throw new GameError(`El-MEKINA needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
    }
    this.hooks = hooks;
    this.T = Object.assign({}, DEFAULT_TIMINGS, hooks.timings || {});
    this.phase = 'playing';
    this.winnerId = null;
    this.log = [];
    this.events = []; // short-lived animation events for clients (additive; log stays the source of truth)
    this.evSeq = 0;
    this.flash = null; // last proven reveal {playerId, character, ts}
    this.timer = null;
    this.deadline = null;
    this.pending = null;
    this.seq = 0;

    // Randomized seating order; play proceeds clockwise through this array.
    this.players = shuffle(seatPlayers).map((p, i) => ({
      id: p.id, name: p.name, seat: i, isBot: !!p.isBot, avatar: p.avatar || null, color: p.color || null,
      connected: p.connected !== false,
      cards: [], coins: 2, alive: true,
    }));

    // 21-card deck = 7 characters x 3 copies, shuffled once, then strictly FIFO.
    this.deck = new Queue(shuffle(CHARACTERS.flatMap(c => Array(COPIES).fill(c))));
    this.handSize = this.players.length <= 4 ? 3 : 2;
    for (const p of this.players) for (let i = 0; i < this.handSize; i++) p.cards.push(this.deck.shift());

    this.turnIndex = Math.floor(Math.random() * this.players.length);
    this.addLog('system', 'game.start', { n: this.players.length, hand: this.handSize });
    this.addLog('system', 'game.order', { names: this.players.map(p => p.name) });
  }

  // ───────────────────────── helpers ─────────────────────────
  get active() { return this.players[this.turnIndex]; }
  player(id) { return this.players.find(p => p.id === id) || null; }
  alivePlayers() { return this.players.filter(p => p.alive); }
  name(id) { const p = this.player(id); return p ? p.name : '?'; }
  cname(c) { return CHAR_NAMES[c] || c; }

  /** Structured log entry: clients render {key, params} in their own language; `text` is the English rendering. */
  addLog(kind, key, params = {}) {
    this.log.push({ id: ++this.seq, t: Date.now(), kind, key, params, text: MSG.format('en', key, params) });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }
  event(type, data = {}) {
    this.events.push({ id: ++this.evSeq, t: Date.now(), type, ...data });
    if (this.events.length > 40) this.events.splice(0, this.events.length - 40);
  }
  sync() { if (this.hooks.onUpdate) this.hooks.onUpdate(this); }

  setTimer(ms, fn) {
    this.clearTimer();
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.phase !== 'playing') return;
      try { fn(); } catch (e) { console.error('[game] timer handler error', e); }
    }, ms);
  }
  clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; this.deadline = null; }
  destroy() { this.clearTimer(); this.phase = 'destroyed'; }

  /** Gain coins, respecting the 14-coin cap. Returns coins actually gained. */
  gain(p, n, fromId = 'bank') {
    const before = p.coins;
    p.coins = Math.min(MAX_COINS, p.coins + n);
    const got = p.coins - before;
    if (got > 0) this.event('coins', { from: fromId, to: p.id, n: got });
    return got;
  }
  /** Gain coins and return a structured {got, n, max} for log params. */
  gainText(p, n, fromId = 'bank') {
    const got = this.gain(p, n, fromId);
    return { got, n, max: MAX_COINS };
  }
  /** Pay coins to the bank (costs). */
  pay(p, n) {
    p.coins -= n;
    this.event('coins', { from: p.id, to: 'bank', n });
  }

  /** Remove a card from a hand, send it to the back of the deck. Never reveals it. */
  /**
   * Remove a card from a hand, send it to the back of the deck. Never reveals it.
   * killerId = the player responsible for this loss; if it was the victim's last card,
   * the victim's coins are transferred to the killer (14-coin cap, excess stays in the bank).
   */
  loseCardAt(p, idx, reason, killerId = null) {
    if (!p.alive || p.cards.length === 0) return;
    idx = Math.max(0, Math.min(idx, p.cards.length - 1));
    const [card] = p.cards.splice(idx, 1);
    this.deck.push(card);
    this.addLog('loss', 'card.lost', { name: p.name, reason, left: p.cards.length });
    this.event('card_lost', { playerId: p.id, killerId: killerId || null });
    if (p.cards.length === 0) {
      p.alive = false;
      this.event('eliminated', { playerId: p.id, killerId: killerId && killerId !== p.id ? killerId : null });
      const killer = killerId && killerId !== p.id ? this.player(killerId) : null;
      const bounty = p.coins;
      p.coins = 0;
      if (killer && killer.alive && bounty > 0) {
        const got = this.gain(killer, bounty, p.id);
        this.addLog('eliminated', 'elim.bounty', { name: p.name, bounty, killer: killer.name, gain: { got, n: bounty, max: MAX_COINS } });
      } else if (bounty > 0) {
        this.addLog('eliminated', 'elim.bank', { name: p.name, bounty });
      } else {
        this.addLog('eliminated', 'elim.plain', { name: p.name });
      }
    }
  }
  loseRandomCard(p, reason, killerId = null) {
    if (!p.alive || p.cards.length === 0) return;
    this.loseCardAt(p, Math.floor(Math.random() * p.cards.length), reason, killerId);
  }
  loseSpecificCard(p, character, reason, killerId = null) {
    const idx = p.cards.indexOf(character);
    if (idx >= 0) this.loseCardAt(p, idx, reason, killerId);
  }

  checkGameOver() {
    if (this.phase !== 'playing') return true;
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      this.clearTimer();
      this.phase = 'ended';
      this.pending = null;
      this.winnerId = alive.length ? alive[0].id : null;
      this.event('win', { playerId: this.winnerId });
      if (alive.length) this.addLog('system', 'game.win', { name: alive[0].name }); else this.addLog('system', 'game.nobody');
      this.sync();
      return true;
    }
    return false;
  }

  // ───────────────────────── turn flow ─────────────────────────
  start() { this.startTurn(); }

  startTurn() {
    if (this.checkGameOver()) return;
    let guard = 0;
    while (!this.active.alive && guard++ < this.players.length) {
      this.turnIndex = (this.turnIndex + 1) % this.players.length;
    }
    const actor = this.active;
    this.pending = { stage: 'turn', actorId: actor.id, action: null, window: null };
    const ms = actor.connected ? this.T.turn : this.T.disconnectedTurn;
    this.setTimer(ms, this._turnTimeoutFn());
    this.pending.deadline = this.deadline;
    this.sync();
  }

  /** End of turn: short readable pause (result window) then hand over. */
  endTurn() {
    this.clearTimer();
    if (this.checkGameOver()) return;
    this.pause('turn_end', {}, () => this._endTurnNow());
  }
  _endTurnNow() {
    this.clearTimer();
    if (this.checkGameOver()) return;
    this.turnIndex = (this.turnIndex + 1) % this.players.length;
    this.startTurn();
  }
  /**
   * Show a "result" window for a moment so players can read what just happened, then continue.
   * kind: 'challenge' | 'turn_end'; data is public (no hidden info).
   */
  pause(kind, data, then) {
    if (this.phase !== 'playing') return;
    const ms = kind === 'turn_end' ? this.T.turnPause : this.T.resultPause;
    if (!ms || ms <= 0) return then();
    if (!this.pending) this.pending = { stage: 'resolving', actorId: this.active.id, action: null, window: null };
    const w = { type: 'result', kind, data, cb: {} };
    w.cb.onTimeout = () => { this.closeWindow(); then(); };
    this.pending.window = w;
    this.setTimer(ms, w.cb.onTimeout);
    w.deadline = this.deadline;
    this.sync();
  }

  // ───────────────────────── declare action ─────────────────────────
  declareAction(playerId, a = {}) {
    if (this.phase !== 'playing') throw new GameError('Game is not running');
    if (!this.pending || this.pending.stage !== 'turn' || this.pending.actorId !== playerId) throw new GameError('It is not your turn');
    const actor = this.player(playerId);
    if (!actor || !actor.alive) throw new GameError('You are out of the game');
    const type = a.type;
    if (!DEFAULT_ACTIONS.includes(type) && !ACTION_CHARACTER[type]) throw new GameError('Unknown action');

    const needsTarget = ['paidkill', 'taxman', 'police', 'terrorist', 'colonel', 'thief'].includes(type);
    let target = null;
    if (needsTarget) {
      target = this.player(a.targetId);
      if (!target || !target.alive) throw new GameError('Invalid target');
      if (type !== 'police' && target.id === actor.id) throw new GameError('You cannot target yourself');
    }
    if (type === 'paidkill' && actor.coins < 7) throw new GameError('Paid Kill costs 7 coins');
    if (type === 'terrorist' && actor.coins < 3) throw new GameError('Terrorist costs 3 coins');
    if (type === 'colonel' && actor.coins < 4) throw new GameError('Colonel costs 4 coins');
    if (type === 'colonel' && !CHARACTERS.includes(a.guess)) throw new GameError('You must guess a character');
    if (type === 'taxman' && target.coins <= 7) throw new GameError('Wealth tax target must hold more than 7 coins');
    if (type === 'thief' && target.coins <= 0) throw new GameError('Target has no coins to steal');
    let slot = 0;
    if (type === 'police') {
      slot = Number.isInteger(a.slot) ? a.slot : 0;
      if (slot < 0 || slot >= target.cards.length) throw new GameError('Invalid card slot');
    }

    this.clearTimer();
    const action = { type, actorId: actor.id, targetId: target ? target.id : null, guess: a.guess || null, slot, character: ACTION_CHARACTER[type] || null };
    this.pending = { stage: 'resolving', actorId: actor.id, action, window: null, logStart: this.seq };

    const tn = target ? target.name : '';
    switch (type) {
      case 'income':
        this.addLog('action', 'income', { name: actor.name, gain: this.gainText(actor, 1) });
        return this.endTurn();

      case 'loan':
        this.addLog('action', 'loan.ask', { name: actor.name });
        return this.openBlockWindow(
          { kind: 'veto', character: 'taxman', eligible: this.alivePlayers().filter(p => p.id !== actor.id).map(p => p.id) },
          () => { this.addLog('coins', 'loan.get', { name: actor.name, gain: this.gainText(actor, 2) }); this.endTurn(); },
          (blockerId) => {
            const b = this.player(blockerId);
            this.addLog('block', 'loan.veto', { blocker: b.name, name: actor.name });
            this.openChallengeWindow(
              { claimerId: blockerId, character: 'taxman', kind: 'veto' },
              () => { this.addLog('block', 'loan.vetoed', { name: actor.name }); this.endTurn(); },
              () => { this.addLog('coins', 'loan.vetofail', { name: actor.name, gain: this.gainText(actor, 2) }); this.endTurn(); }
            );
          }
        );

      case 'paidkill':
        this.pay(actor, 7);
        this.addLog('action', 'paidkill', { name: actor.name, target: tn });
        return this.doKill(target.id, 'paidkill', { canPay: true }, () => this.endTurn());

      case 'terrorist':
        this.pay(actor, 3);
        this.addLog('claim', 'claim.terrorist', { name: actor.name, target: tn });
        break;
      case 'colonel':
        this.pay(actor, 4);
        this.addLog('claim', 'claim.colonel', { name: actor.name, target: tn, guess: a.guess });
        break;
      case 'businesswoman':
        this.addLog('claim', 'claim.businesswoman', { name: actor.name });
        break;
      case 'taxman':
        this.addLog('claim', 'claim.taxman', { name: actor.name, target: tn });
        break;
      case 'police':
        this.addLog('claim', target.id === actor.id ? 'claim.police.self' : 'claim.police', { name: actor.name, target: tn });
        break;
      case 'politician':
        this.addLog('claim', 'claim.politician', { name: actor.name });
        break;
      case 'thief':
        this.addLog('claim', 'claim.thief', { name: actor.name, target: tn });
        break;
    }

    // Character claims: one reaction window — anyone may call the bluff; the target (or, for the
    // Business Woman tax, anyone) may react with a block claim of their own.
    const claim = { claimerId: actor.id, character: action.character, kind: 'action' };
    const others = this.alivePlayers().filter(p => p.id !== actor.id).map(p => p.id); // anyone may counter, target included
    const fail = () => { this.addLog('challenge', 'action.fail', { name: actor.name }); this.endTurn(); };
    const blockedBy = (blockCharacter, what, onBlockFails) => (blockerId) => {
      this.addLog('block', 'block.claim', { name: this.name(blockerId), character: blockCharacter, what });
      this.openChallengeWindow(
        { claimerId: blockerId, character: blockCharacter, kind: 'block' },
        () => { this.addLog('block', 'block.ok', { what }); this.endTurn(); },
        () => { this.addLog('block', 'block.fail', { what }); onBlockFails(); }
      );
    };

    switch (type) {
      case 'businesswoman':
        return this.runBusinessWoman(claim, fail);
      case 'police':
        if (target.id === actor.id) return this.openChallengeWindow(claim, () => this.doPoliceLook(), fail);
        return this.openReactionWindow(
          { claim, block: { kind: 'block', character: 'police', eligible: others } },
          { onProceed: () => this.doPoliceLook(), onFail: fail, onBlocked: blockedBy('police', 'inspection', () => this.doPoliceLook()) }
        );
      case 'terrorist':
        return this.openReactionWindow(
          { claim, block: { kind: 'block', character: 'colonel', eligible: others } },
          { onProceed: () => this.doKill(target.id, 'terrorist', {}, () => this.endTurn()), onFail: fail,
            onBlocked: blockedBy('colonel', 'kill', () => this.doKill(target.id, 'terrorist', {}, () => this.endTurn())) }
        );
      case 'thief':
        return this.openReactionWindow(
          { claim, block: { kind: 'block', character: 'thief', eligible: others } },
          { onProceed: () => this.doSteal(), onFail: fail, onBlocked: blockedBy('thief', 'theft', () => this.doSteal()) }
        );
      default:
        // taxman, colonel, politician: not blockable
        return this.openChallengeWindow(claim, () => this.resolveClaim(), fail);
    }
  }

  /** Business Woman: take 4; every other player may separately claim Tax Man to take 1 of those coins. */
  runBusinessWoman(claim, fail) {
    const actor = this.player(claim.claimerId);
    const taxers = [], declined = [];
    const payout = () => {
      if (!actor.alive) { this.addLog('system', 'bw.out', { name: actor.name }); return this.endTurn(); }
      const k = taxers.length;
      const bw = Math.max(0, 4 - k);
      if (k === 0) this.addLog('coins', 'bw.take4', { name: actor.name, gain: this.gainText(actor, 4) });
      else {
        const parts = taxers.map(id => { const t = this.player(id); return { name: t.name, gain: t.alive ? this.gainText(t, 1) : { got: 0, n: 1, max: MAX_COINS } }; });
        this.addLog('coins', 'bw.taxed', { name: actor.name, kept: bw, gain: this.gainText(actor, bw), parts });
      }
      this.endTurn();
    };
    const openTax = (claimable) => {
      if (this.phase !== 'playing') return;
      if (!actor.alive) return payout();
      const eligible = this.alivePlayers().filter(p => p.id !== actor.id && !taxers.includes(p.id) && !declined.includes(p.id)).map(p => p.id);
      this.openReactionWindow(
        { claim: claimable ? claim : null, block: { kind: 'tax', character: 'taxman', eligible } },
        {
          onProceed: payout,
          onFail: fail,
          onBlocked: (taxerId, w) => {
            for (const id of w.passed) if (!declined.includes(id)) declined.push(id);
            const taxer = this.player(taxerId);
            this.addLog('block', 'bw.taxclaim', { name: taxer.name, target: actor.name });
            this.openChallengeWindow(
              { claimerId: taxerId, character: 'taxman', kind: 'tax' },
              () => { taxers.push(taxerId); openTax(false); },
              () => { declined.push(taxerId); openTax(false); }
            );
          },
        }
      );
    };
    openTax(true);
  }

  /** Resolve a non-blockable claim that survived (Tax Man wealth tax, Colonel, Politician). */
  resolveClaim() {
    if (this.phase !== 'playing') return;
    const { action } = this.pending;
    const actor = this.player(action.actorId);
    const target = action.targetId ? this.player(action.targetId) : null;
    if (!actor.alive) { this.addLog('system', 'actor.out', { name: actor.name }); return this.endTurn(); }

    switch (action.type) {
      case 'taxman': {
        if (!target.alive || target.coins < 1) { this.addLog('coins', 'tax.nothing', { name: target.name }); return this.endTurn(); }
        target.coins -= 1;
        this.addLog('coins', 'tax.take', { name: actor.name, target: target.name, gain: this.gainText(actor, 1, target.id) });
        return this.endTurn();
      }
      case 'colonel': {
        if (!target.alive) { this.addLog('system', 'colonel.targetout', { name: target.name }); return this.endTurn(); }
        if (target.cards.includes(action.guess)) {
          this.addLog('loss', 'colonel.right', { target: target.name, guess: action.guess });
          this.loseSpecificCard(target, action.guess, 'colonel_correct', actor.id);
        } else {
          this.addLog('loss', 'colonel.wrong', { target: target.name, guess: action.guess, name: actor.name, gain: this.gainText(target, 4) });
          this.loseRandomCard(actor, 'wrong_guess', target.id);
        }
        if (this.checkGameOver()) return;
        return this.endTurn();
      }
      case 'politician': {
        const n = actor.cards.length;
        for (const c of actor.cards) this.deck.push(c);
        actor.cards = [];
        for (let i = 0; i < n; i++) actor.cards.push(this.deck.shift());
        this.addLog('action', 'politician.swap', { name: actor.name, n });
        return this.endTurn();
      }
    }
  }

  doSteal() {
    const { action } = this.pending;
    const actor = this.player(action.actorId), target = this.player(action.targetId);
    if (!target.alive) { this.addLog('system', 'steal.out', { name: target.name }); return this.endTurn(); }
    const amount = Math.min(2, target.coins);
    target.coins -= amount;
    this.addLog('coins', 'steal', { name: actor.name, n: amount, target: target.name, gain: this.gainText(actor, amount, target.id) });
    this.endTurn();
  }

  doPoliceLook() {
    const { action } = this.pending;
    const actor = this.player(action.actorId), target = this.player(action.targetId);
    if (!target.alive || target.cards.length === 0) { this.addLog('system', 'police.nocards', { name: target.name }); return this.endTurn(); }
    const slot = Math.min(action.slot, target.cards.length - 1);
    const card = target.cards[slot];
    this.addLog('action', target.id === actor.id ? 'police.look.self' : 'police.look', { name: actor.name, slot: slot + 1, target: target.name });
    this.openDecision(actor.id, 'police', { targetId: target.id, slot, card },
      (choice) => {
        if (choice && choice.swap) {
          if (target.alive && target.cards.length > slot) {
            const old = target.cards[slot];
            target.cards[slot] = this.deck.shift();
            this.deck.push(old);
          }
          this.addLog('action', 'police.swap', { name: actor.name });
        } else {
          this.addLog('action', 'police.keep', { name: actor.name });
        }
        this.endTurn();
      },
      () => { this.addLog('action', 'police.keep', { name: actor.name }); this.endTurn(); }
    );
  }

  /**
   * Kill one card of `targetId`. The target secretly chooses which card to lose.
   * opts.canPay: Paid Kill — target may pay 9 coins to survive.
   */
  doKill(targetId, reason, opts, then) {
    const t = this.player(targetId);
    const killerId = this.pending && this.pending.action ? this.pending.action.actorId : null;
    if (!t.alive) { this.addLog('system', 'kill.out', { name: t.name }); return then(); }
    const canPay = !!(opts && opts.canPay) && t.coins >= 9;
    if (!canPay && t.cards.length === 1) {
      this.loseCardAt(t, 0, reason, killerId);
      if (this.checkGameOver()) return;
      return then();
    }
    this.openDecision(t.id, 'lose_card', { reason, canPay, payCost: 9 },
      (choice) => {
        if (canPay && choice && choice.pay) {
          this.pay(t, 9);
          this.addLog('coins', 'kill.survive', { name: t.name, reason });
          return then();
        }
        const idx = choice && Number.isInteger(choice.index) ? choice.index : Math.floor(Math.random() * t.cards.length);
        this.loseCardAt(t, idx, reason, killerId);
        if (this.checkGameOver()) return;
        then();
      },
      () => {
        this.loseRandomCard(t, `${reason}_timeout`, killerId);
        if (this.checkGameOver()) return;
        then();
      }
    );
  }

  // ───────────────────────── windows ─────────────────────────
  closeWindow() { const w = this.pending ? this.pending.window : null; if (this.pending) this.pending.window = null; return w; }

  /**
   * Unified reaction window.
   *   spec.claim  = {claimerId, character, kind}  — may be challenged by any other player (null = nothing to challenge)
   *   spec.block  = {kind:'block'|'veto'|'tax', character, eligible:[ids]} — may be claimed by an eligible player (null = not blockable)
   *   cbs.onProceed()            nobody challenged/blocked (or the claim was proven and no block followed)
   *   cbs.onFail()               claimer was bluffing
   *   cbs.onBlocked(id, window)  an eligible player claimed the blocking character
   * Calling the bluff is always available while spec.claim is set; the block is the contextual primary option.
   */
  openReactionWindow(spec, cbs) {
    if (this.phase !== 'playing') return;
    const claim = spec.claim || null;
    const block = spec.block ? { ...spec.block, eligible: spec.block.eligible.filter(id => { const p = this.player(id); return p && p.alive && p.connected; }) } : null;
    const challengeEligible = claim ? this.alivePlayers().filter(p => p.id !== claim.claimerId && p.connected).map(p => p.id) : [];
    const blockEligible = block ? block.eligible : [];
    const eligible = [...new Set([...challengeEligible, ...blockEligible])];
    if (eligible.length === 0) return cbs.onProceed();
    const w = { type: 'reaction', claim, block, challengeEligible, blockEligible, eligible, passed: [], challengerId: null, blockerId: null, cb: cbs };
    w.cb.onTimeout = () => { this.closeWindow(); cbs.onProceed(); };
    this.pending.window = w;
    this.setTimer(claim ? this.T.challenge : this.T.block, w.cb.onTimeout);
    w.deadline = this.deadline;
    this.sync();
  }
  openChallengeWindow(claim, onSurvive, onFail) { this.openReactionWindow({ claim }, { onProceed: onSurvive, onFail }); }
  openBlockWindow(spec, onNoBlock, onBlocked) { this.openReactionWindow({ block: spec }, { onProceed: onNoBlock, onBlocked }); }

  /** Call the bluff on the pending claim. First challenger (server arrival order) is the official one. */
  challenge(playerId) {
    if (this.phase !== 'playing') throw new GameError('Game is not running');
    const w = this.pending && this.pending.window;
    if (!w || w.type !== 'reaction' || !w.claim) throw new GameError('Nothing to challenge right now');
    if (w.challengerId) throw new GameError(`${this.name(w.challengerId)} already challenged`);
    if (!w.challengeEligible.includes(playerId)) throw new GameError('You cannot challenge this claim');
    w.challengerId = playerId;
    w.challengedAt = Date.now();
    this.clearTimer();
    const claimer = this.player(w.claim.claimerId);
    const challenger = this.player(playerId);
    const ch = w.claim.character;
    const cbs = w.cb;
    const block = w.block;
    this.closeWindow();

    if (claimer.cards.includes(ch)) {
      // Truthful: reveal, return to back, draw replacement; challenger loses a random card; the action goes on.
      this.addLog('challenge', 'bluff.true', { challenger: challenger.name, name: claimer.name, character: ch });
      this.flash = { playerId: claimer.id, character: ch, ts: Date.now() };
      this.event('reveal', { playerId: claimer.id, character: ch, challengerId: challenger.id });
      const idx = claimer.cards.indexOf(ch);
      claimer.cards.splice(idx, 1);
      this.deck.push(ch);
      claimer.cards.push(this.deck.shift());
      this.addLog('reveal', 'bluff.replace', { name: claimer.name, character: ch });
      this.loseRandomCard(challenger, 'lost_challenge', claimer.id);
      if (this.checkGameOver()) return;
      this.sync();
      // Let everyone read the outcome, then: the claim is proven — the block (if any) is still possible.
      this.pause('challenge', { result: 'true', claimerId: claimer.id, challengerId: challenger.id, character: ch }, () => {
        if (block) return this.openReactionWindow({ block }, cbs);
        cbs.onProceed();
      });
    } else {
      this.addLog('challenge', 'bluff.caught', { challenger: challenger.name, name: claimer.name, character: ch });
      this.event('bluff', { playerId: claimer.id, character: ch, challengerId: challenger.id });
      this.loseRandomCard(claimer, 'caught_bluffing', challenger.id);
      if (this.checkGameOver()) return;
      this.sync();
      this.pause('challenge', { result: 'bluff', claimerId: claimer.id, challengerId: challenger.id, character: ch }, () => cbs.onFail());
    }
  }

  /** Block / veto / tax by claiming the blocking character. */
  block(playerId) {
    if (this.phase !== 'playing') throw new GameError('Game is not running');
    const w = this.pending && this.pending.window;
    if (!w || w.type !== 'reaction' || !w.block) throw new GameError('Nothing to block right now');
    if (w.blockerId) throw new GameError('Already blocked');
    if (!w.blockEligible.includes(playerId)) throw new GameError('You cannot block this action');
    w.blockerId = playerId;
    this.clearTimer();
    const cbs = w.cb;
    this.event('block', { playerId, kind: w.block.kind, character: w.block.character });
    this.closeWindow();
    cbs.onBlocked(playerId, w);
  }

  /** Decline to react. When everyone eligible has passed, the window closes early. */
  pass(playerId) {
    if (this.phase !== 'playing') return;
    const w = this.pending && this.pending.window;
    if (!w || w.type !== 'reaction') return;
    if (!w.eligible.includes(playerId) || w.passed.includes(playerId)) return;
    w.passed.push(playerId);
    if (w.eligible.every(id => w.passed.includes(id))) {
      this.clearTimer();
      w.cb.onTimeout();
    } else {
      this.sync();
    }
  }

  openDecision(playerId, kind, data, onChoice, onTimeout) {
    if (this.phase !== 'playing') return;
    const p = this.player(playerId);
    const w = { type: 'decision', kind, playerId, data, cb: { onChoice } };
    w.cb.onTimeout = () => { this.closeWindow(); onTimeout(); };
    this.pending.window = w;
    this.setTimer(p.connected ? this.T.decision : this.T.disconnectedDecision, w.cb.onTimeout);
    w.deadline = this.deadline;
    this.sync();
  }

  decide(playerId, choice) {
    if (this.phase !== 'playing') throw new GameError('Game is not running');
    const w = this.pending && this.pending.window;
    if (!w || w.type !== 'decision') throw new GameError('No decision pending');
    if (w.playerId !== playerId) throw new GameError('This decision is not yours');
    if (w.kind === 'lose_card') {
      const p = this.player(playerId);
      if (choice && choice.pay && !w.data.canPay) throw new GameError('You cannot pay to survive');
      if (choice && !choice.pay && (!Number.isInteger(choice.index) || choice.index < 0 || choice.index >= p.cards.length)) throw new GameError('Invalid card');
    }
    this.clearTimer();
    const { onChoice } = w.cb;
    this.closeWindow();
    onChoice(choice || {});
  }

  // ───────────────────────── connectivity ─────────────────────────
  /** Update a player's avatar/colour mid-game (cosmetic only). */
  setProfile(playerId, { avatar, color }) {
    const p = this.player(playerId); if (!p) return;
    if (avatar) p.avatar = avatar; if (color) p.color = color;
    this.sync();
  }

  setConnected(playerId, connected) {
    const p = this.player(playerId);
    if (!p) return;
    p.connected = connected;
    if (this.phase !== 'playing') return this.sync();
    const pend = this.pending;
    if (!connected && pend) {
      if (pend.stage === 'turn' && pend.actorId === playerId && this.timer) {
        // shorten the active player's turn timer
        const remaining = this.deadline - Date.now();
        if (remaining > this.T.disconnectedTurn) {
          const fn = this._turnTimeoutFn();
          this.setTimer(this.T.disconnectedTurn, fn);
          pend.deadline = this.deadline;
        }
      } else if (pend.window) {
        const w = pend.window;
        if (w.type === 'reaction' && w.eligible.includes(playerId)) {
          return this.pass(playerId); // a disconnected player is treated as passing
        }
        if (w.type === 'decision' && w.playerId === playerId && this.deadline - Date.now() > this.T.disconnectedDecision) {
          this.setTimer(this.T.disconnectedDecision, w.cb.onTimeout);
          w.deadline = this.deadline;
        }
      }
    }
    this.sync();
  }
  _turnTimeoutFn() {
    const actor = this.active;
    return () => {
      this.addLog('system', actor.connected ? 'timeout' : 'disconnected', { name: actor.name });
      this.pending = { stage: 'resolving', actorId: actor.id, action: { type: 'income', actorId: actor.id }, window: null };
      this.addLog('action', 'income', { name: actor.name, gain: this.gainText(actor, 1) });
      this.endTurn();
    };
  }

  // ───────────────────────── per-player view (never leaks hidden cards) ─────────────────────────
  viewFor(playerId) {
    const me = this.player(playerId);
    const pend = this.pending;
    const w = pend && pend.window;
    let window = null;
    if (w) {
      window = {
        type: w.type,
        deadline: w.deadline || null,
        eligible: w.eligible || [], passed: w.passed || [],
        claim: w.claim ? { claimerId: w.claim.claimerId, character: w.claim.character, kind: w.claim.kind } : null,
        block: w.block ? { kind: w.block.kind, character: w.block.character, eligible: w.block.eligible } : null,
        challengeEligible: w.challengeEligible || [],
        blockEligible: w.blockEligible || [],
        kind: w.kind || null,
        playerId: w.playerId || null,
      };
      if (w.type === 'decision' && w.playerId === playerId) window.data = w.data; // private (e.g. police peek)
      if (w.type === 'result') window.data = w.data; // public outcome summary
    }
    return {
      phase: this.phase,
      winnerId: this.winnerId,
      serverTime: Date.now(),
      timings: this.T,
      maxCoins: MAX_COINS,
      handSize: this.handSize,
      deckSize: this.deck.length,
      turnPlayerId: this.phase === 'playing' ? this.active.id : null,
      players: this.players.map(p => ({
        id: p.id, name: p.name, seat: p.seat, coins: p.coins, isBot: p.isBot, avatar: p.avatar, color: p.color,
        cardCount: p.cards.length, alive: p.alive, connected: p.connected,
      })),
      you: me ? { id: me.id, cards: me.cards.slice(), alive: me.alive, coins: me.coins } : null,
      log: this.log.slice(-120),
      events: this.events.slice(-40),
      flash: this.flash && Date.now() - this.flash.ts < 6000 ? this.flash : null,
      pending: pend ? {
        stage: pend.stage, actorId: pend.actorId, logStart: pend.logStart || 0,
        deadline: pend.stage === 'turn' ? pend.deadline : null,
        action: pend.action ? { type: pend.action.type, actorId: pend.action.actorId, targetId: pend.action.targetId, guess: pend.action.guess, character: pend.action.character } : null,
        window,
      } : null,
    };
  }
}

module.exports = { Game, GameError, Queue, CHARACTERS, CHAR_NAMES, MAX_COINS, MIN_PLAYERS, MAX_PLAYERS, DEFAULT_TIMINGS };
