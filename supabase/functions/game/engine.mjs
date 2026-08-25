/**
 * ELMAKINA — authoritative game engine (serverless edition).
 *
 * Same rules as before, but the engine is now a *serializable, deadline-driven state machine*:
 *   • no timers: every timed window stores a `deadline`; `tick(now)` fires whatever is due
 *   • no closures: every continuation is a small data descriptor run by `run(cont)`
 *   • `toJSON()` / `Game.fromJSON()` round-trip the whole state through Postgres between requests
 *
 * Resolution order for every action:
 *   1. active player declares
 *   2. character claim  -> reaction window (anyone may call the bluff; eligible players may counter)
 *   3. resolve -> readable pause -> next turn
 */
import * as MSG from './messages.mjs';

export const CHARACTERS = ['taxman', 'businesswoman', 'police', 'terrorist', 'colonel', 'politician', 'thief'];
export const CHAR_NAMES = { taxman: 'Tax Man', businesswoman: 'Business Woman', police: 'Police', terrorist: 'Terrorist', colonel: 'Colonel', politician: 'Politician', thief: 'Thief' };
export const COPIES = 3;
export const MAX_COINS = 14;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
const ACTION_CHARACTER = { businesswoman: 'businesswoman', taxman: 'taxman', police: 'police', terrorist: 'terrorist', colonel: 'colonel', politician: 'politician', thief: 'thief' };
const DEFAULT_ACTIONS = ['income', 'loan', 'paidkill'];

export const DEFAULT_TIMINGS = {
  challenge: 12000,       // reaction window when a claim can be challenged
  block: 10000,           // counter-only window (veto / tax / block after a proven claim)
  decision: 20000,        // choose card to lose, pay to survive, police keep/swap
  resultPause: 3200,      // pause to show the outcome of a bluff call before continuing
  turnPause: 2200,        // pause at the end of a turn so everyone can read what happened
  turn: 60000,            // time for the active player to declare an action
  disconnectedTurn: 8000, // shortened turn timer when the active player is disconnected
  disconnectedDecision: 2500,
};

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** A real FIFO queue: draw from the front, return to the back. */
export class Queue {
  constructor(items = []) { this._items = items.slice(); this._head = 0; }
  get length() { return this._items.length - this._head; }
  shift() { if (this.length === 0) throw new Error('Deck is empty'); const v = this._items[this._head++]; if (this._head > 64) { this._items = this._items.slice(this._head); this._head = 0; } return v; }
  push(v) { this._items.push(v); }
  toArray() { return this._items.slice(this._head); }
}

export class GameError extends Error {}

const TIMEOUT = { k: 'windowTimeout' };

export class Game {
  /**
   * @param {Array<{id:string,name:string,connected?:boolean,isBot?:boolean,avatar?:string,color?:string}>} seatPlayers
   * @param {{timings?:object, now?:()=>number, onUpdate?:Function}} opts
   */
  constructor(seatPlayers, opts = {}) {
    if (!seatPlayers) return; // fromJSON path
    if (seatPlayers.length < MIN_PLAYERS || seatPlayers.length > MAX_PLAYERS) throw new GameError(`El-MEKINA needs ${MIN_PLAYERS}-${MAX_PLAYERS} players`);
    this._init(opts);
    this.T = Object.assign({}, DEFAULT_TIMINGS, opts.timings || {});
    this.phase = 'playing';
    this.winnerId = null;
    this.outOrder = []; // player ids in the order they were eliminated (first out = last place)
    this.log = [];
    this.events = [];
    this.evSeq = 0;
    this.seq = 0;
    this.flash = null;
    this.deadline = null;
    this.due = null;
    this.pending = null;
    this.players = shuffle(seatPlayers).map((p, i) => ({ id: p.id, name: p.name, seat: i, isBot: !!p.isBot, avatar: p.avatar || null, color: p.color || null, connected: p.connected !== false, cards: [], coins: 2, alive: true }));
    this.deck = new Queue(shuffle(CHARACTERS.flatMap((c) => Array(COPIES).fill(c))));
    this.handSize = this.players.length <= 4 ? 3 : 2;
    for (const p of this.players) for (let i = 0; i < this.handSize; i++) p.cards.push(this.deck.shift());
    this.turnIndex = Math.floor(Math.random() * this.players.length);
    this.addLog('system', 'game.start', { n: this.players.length, hand: this.handSize });
    this.addLog('system', 'game.order', { names: this.players.map((p) => p.name) });
  }
  _init(opts) { this.nowFn = opts.now || (() => Date.now()); this.onUpdate = opts.onUpdate || null; this.changes = 0; }
  now() { return this.nowFn(); }

  // ───────────────────────── (de)serialization ─────────────────────────
  toJSON() {
    return { phase: this.phase, winnerId: this.winnerId, outOrder: this.outOrder, log: this.log, events: this.events, evSeq: this.evSeq, seq: this.seq, flash: this.flash, deadline: this.deadline, due: this.due, pending: this.pending, players: this.players, deck: this.deck.toArray(), handSize: this.handSize, turnIndex: this.turnIndex, T: this.T };
  }
  static fromJSON(o, opts = {}) {
    const g = new Game(null, opts); g._init(opts);
    Object.assign(g, { phase: o.phase, winnerId: o.winnerId, outOrder: o.outOrder || [], log: o.log || [], events: o.events || [], evSeq: o.evSeq || 0, seq: o.seq || 0, flash: o.flash || null, deadline: o.deadline ?? null, due: o.due || null, pending: o.pending || null, players: o.players, handSize: o.handSize, turnIndex: o.turnIndex, T: Object.assign({}, DEFAULT_TIMINGS, o.T || {}) });
    g.deck = new Queue(o.deck || []);
    return g;
  }

  // ───────────────────────── helpers ─────────────────────────
  get active() { return this.players[this.turnIndex]; }
  player(id) { return this.players.find((p) => p.id === id) || null; }
  alivePlayers() { return this.players.filter((p) => p.alive); }
  name(id) { const p = this.player(id); return p ? p.name : '?'; }
  addLog(kind, key, params = {}) {
    this.log.push({ id: ++this.seq, t: this.now(), kind, key, params, text: MSG.format('en', key, params) });
    if (this.log.length > 300) this.log.splice(0, this.log.length - 300);
  }
  event(type, data = {}) { this.events.push({ id: ++this.evSeq, t: this.now(), type, ...data }); if (this.events.length > 40) this.events.splice(0, this.events.length - 40); }
  sync() { this.changes++; if (this.onUpdate) this.onUpdate(this); }

  /** Schedule the continuation `cont` to run at now+ms (replaces any previous schedule). */
  setDue(ms, cont) { this.deadline = this.now() + ms; this.due = cont; }
  clearDue() { this.deadline = null; this.due = null; }
  /** Next moment something will happen by itself (or null). */
  nextDue() { return this.phase === 'playing' ? this.deadline : null; }
  /**
   * Advance time: fire every continuation whose deadline has passed. Returns true if anything happened.
   * Safe to call as often as you like (clients + cron both call it).
   */
  tick(now = this.now()) {
    let fired = 0;
    for (let guard = 0; guard < 50; guard++) {
      if (this.phase !== 'playing' || this.deadline == null || now < this.deadline) break;
      const c = this.due; this.clearDue(); fired++;
      this.run(c);
    }
    return fired > 0;
  }
  destroy() { this.clearDue(); this.phase = 'destroyed'; }

  gain(p, n, fromId = 'bank') { const before = p.coins; p.coins = Math.min(MAX_COINS, p.coins + n); const got = p.coins - before; if (got > 0) this.event('coins', { from: fromId, to: p.id, n: got }); return got; }
  gainText(p, n, fromId = 'bank') { const got = this.gain(p, n, fromId); return { got, n, max: MAX_COINS }; }
  pay(p, n) { p.coins -= n; this.event('coins', { from: p.id, to: 'bank', n }); }

  loseCardAt(p, idx, reason, killerId = null) {
    if (!p.alive || p.cards.length === 0) return;
    idx = Math.max(0, Math.min(idx, p.cards.length - 1));
    const [card] = p.cards.splice(idx, 1);
    this.deck.push(card);
    this.addLog('loss', 'card.lost', { name: p.name, reason, left: p.cards.length });
    this.event('card_lost', { playerId: p.id, killerId: killerId || null });
    if (p.cards.length === 0) {
      p.alive = false;
      if (!this.outOrder.includes(p.id)) this.outOrder.push(p.id); // record finish order for trophies
      this.event('eliminated', { playerId: p.id, killerId: killerId && killerId !== p.id ? killerId : null });
      const killer = killerId && killerId !== p.id ? this.player(killerId) : null;
      const bounty = p.coins; p.coins = 0;
      if (killer && killer.alive && bounty > 0) { const got = this.gain(killer, bounty, p.id); this.addLog('eliminated', 'elim.bounty', { name: p.name, bounty, killer: killer.name, gain: { got, n: bounty, max: MAX_COINS } }); }
      else if (bounty > 0) this.addLog('eliminated', 'elim.bank', { name: p.name, bounty });
      else this.addLog('eliminated', 'elim.plain', { name: p.name });
    }
  }
  loseRandomCard(p, reason, killerId = null) { if (!p.alive || p.cards.length === 0) return; this.loseCardAt(p, Math.floor(Math.random() * p.cards.length), reason, killerId); }
  loseSpecificCard(p, character, reason, killerId = null) { const idx = p.cards.indexOf(character); if (idx >= 0) this.loseCardAt(p, idx, reason, killerId); }

  checkGameOver() {
    if (this.phase !== 'playing') return true;
    const alive = this.alivePlayers();
    if (alive.length <= 1) {
      this.clearDue(); this.phase = 'ended'; this.pending = null; this.winnerId = alive.length ? alive[0].id : null;
      this.event('win', { playerId: this.winnerId });
      if (alive.length) this.addLog('system', 'game.win', { name: alive[0].name }); else this.addLog('system', 'game.nobody');
      this.sync(); return true;
    }
    return false;
  }

  // ───────────────────────── continuations ─────────────────────────
  /** Run a continuation descriptor. `arg` is the event payload (blocker id, choice, …). */
  run(c, arg, arg2) {
    if (!c || this.phase !== 'playing') return;
    switch (c.k) {
      case 'windowTimeout': {
        const w = this.closeWindow(); if (!w) return;
        if (w.type === 'reaction') return this.run(w.cb.onProceed);
        if (w.type === 'decision') return this.run(w.cb.onTimeout);
        if (w.type === 'result') return this.run(w.then);
        return;
      }
      case 'turnTimeout': return this.turnTimeout(c.actorId);
      case 'endTurn': return this.endTurn();
      case 'endTurnNow': return this._endTurnNow();
      case 'actionFail': { this.addLog('challenge', 'action.fail', { name: this.name(this.pending.actorId) }); return this.endTurn(); }
      // loan
      case 'loanGet': { const a = this.player(this.pending.actorId); this.addLog('coins', 'loan.get', { name: a.name, gain: this.gainText(a, 2) }); return this.endTurn(); }
      case 'loanVeto': { const a = this.player(this.pending.actorId); const b = this.player(arg); this.addLog('block', 'loan.veto', { blocker: b.name, name: a.name });
        return this.openChallengeWindow({ claimerId: arg, character: 'taxman', kind: 'veto' }, { k: 'loanVetoed' }, { k: 'loanVetoFail' }); }
      case 'loanVetoed': { this.addLog('block', 'loan.vetoed', { name: this.name(this.pending.actorId) }); return this.endTurn(); }
      case 'loanVetoFail': { const a = this.player(this.pending.actorId); this.addLog('coins', 'loan.vetofail', { name: a.name, gain: this.gainText(a, 2) }); return this.endTurn(); }
      // kills
      case 'kill': return this.doKill(c.targetId, c.reason, { canPay: !!c.canPay }, c.then);
      case 'killChoice': return this.killChoice(c, arg || {});
      case 'killTimeout': { const t = this.player(c.targetId); const killerId = this.pending && this.pending.action ? this.pending.action.actorId : null; this.loseRandomCard(t, `${c.reason}_timeout`, killerId); if (this.checkGameOver()) return; return this.run(c.then); }
      // police
      case 'policeLook': return this.doPoliceLook();
      case 'policeChoice': return this.policeChoice(arg || {});
      case 'policeKeep': { this.addLog('action', 'police.keep', { name: this.name(this.pending.actorId) }); return this.endTurn(); }
      // others
      case 'steal': return this.doSteal();
      case 'resolveClaim': return this.resolveClaim();
      case 'blockedBy': { this.addLog('block', 'block.claim', { name: this.name(arg), character: c.character, what: c.what });
        return this.openChallengeWindow({ claimerId: arg, character: c.character, kind: 'block' }, { k: 'blockOk', what: c.what }, { k: 'blockFail', what: c.what, after: c.after }); }
      case 'blockOk': { this.addLog('block', 'block.ok', { what: c.what }); return this.endTurn(); }
      case 'blockFail': { this.addLog('block', 'block.fail', { what: c.what }); return this.run(c.after); }
      // business woman
      case 'bwOpenTax': return this.bwOpenTax();
      case 'bwPayout': return this.bwPayout();
      case 'bwResolveTax': return this.bwResolveTax();
      case 'bwOpenMultiChallenge': return this.bwOpenMultiChallenge();
      case 'bwProvenReopen': { this.pending.bw.proven = true; return this.bwOpenTax(); }
      case 'reopenBlock': return this.openReactionWindow({ block: c.block }, c.cbs);
      default: throw new Error('Unknown continuation ' + c.k);
    }
  }

  // ───────────────────────── turn flow ─────────────────────────
  start() { this.startTurn(); }
  startTurn() {
    if (this.checkGameOver()) return;
    let guard = 0;
    while (!this.active.alive && guard++ < this.players.length) this.turnIndex = (this.turnIndex + 1) % this.players.length;
    const actor = this.active;
    this.pending = { stage: 'turn', actorId: actor.id, action: null, window: null };
    this.setDue(actor.connected ? this.T.turn : this.T.disconnectedTurn, { k: 'turnTimeout', actorId: actor.id });
    this.pending.deadline = this.deadline;
    this.sync();
  }
  endTurn() { this.clearDue(); if (this.checkGameOver()) return; this.pause('turn_end', {}, { k: 'endTurnNow' }); }
  _endTurnNow() { this.clearDue(); if (this.checkGameOver()) return; this.turnIndex = (this.turnIndex + 1) % this.players.length; this.startTurn(); }
  turnTimeout(actorId) {
    const actor = this.player(actorId);
    this.addLog('system', actor.connected ? 'timeout' : 'disconnected', { name: actor.name });
    this.pending = { stage: 'resolving', actorId: actor.id, action: { type: 'income', actorId: actor.id }, window: null };
    this.addLog('action', 'income', { name: actor.name, gain: this.gainText(actor, 1) });
    this.endTurn();
  }
  /** Show a "result" window so players can read what just happened, then continue with `then`. */
  pause(kind, data, then) {
    if (this.phase !== 'playing') return;
    const ms = kind === 'turn_end' ? this.T.turnPause : this.T.resultPause;
    if (!ms || ms <= 0) return this.run(then);
    if (!this.pending) this.pending = { stage: 'resolving', actorId: this.active.id, action: null, window: null };
    const w = { type: 'result', kind, data, then };
    this.pending.window = w;
    this.setDue(ms, TIMEOUT); w.deadline = this.deadline;
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
    if (type === 'police') { slot = Number.isInteger(a.slot) ? a.slot : 0; if (slot < 0 || slot >= target.cards.length) throw new GameError('Invalid card slot'); }

    this.clearDue();
    const action = { type, actorId: actor.id, targetId: target ? target.id : null, guess: a.guess || null, slot, character: ACTION_CHARACTER[type] || null };
    this.pending = { stage: 'resolving', actorId: actor.id, action, window: null, logStart: this.seq };
    const tn = target ? target.name : '';
    switch (type) {
      case 'income': this.addLog('action', 'income', { name: actor.name, gain: this.gainText(actor, 1) }); return this.endTurn();
      case 'loan': this.addLog('action', 'loan.ask', { name: actor.name });
        return this.openBlockWindow({ kind: 'veto', character: 'taxman', eligible: this.alivePlayers().filter((p) => p.id !== actor.id).map((p) => p.id) }, { k: 'loanGet' }, { k: 'loanVeto' });
      case 'paidkill': this.pay(actor, 7); this.event('coup', { playerId: actor.id, targetId: target.id }); this.addLog('action', 'paidkill', { name: actor.name, target: tn }); return this.doKill(target.id, 'paidkill', { canPay: true }, { k: 'endTurn' });
      case 'terrorist': this.pay(actor, 3); this.addLog('claim', 'claim.terrorist', { name: actor.name, target: tn }); break;
      case 'colonel': this.pay(actor, 4); this.addLog('claim', 'claim.colonel', { name: actor.name, target: tn, guess: a.guess }); break;
      case 'businesswoman': this.addLog('claim', 'claim.businesswoman', { name: actor.name }); break;
      case 'taxman': this.addLog('claim', 'claim.taxman', { name: actor.name, target: tn }); break;
      case 'police': this.addLog('claim', target.id === actor.id ? 'claim.police.self' : 'claim.police', { name: actor.name, target: tn }); break;
      case 'politician': this.addLog('claim', 'claim.politician', { name: actor.name }); break;
      case 'thief': this.addLog('claim', 'claim.thief', { name: actor.name, target: tn }); break;
    }
    const claim = { claimerId: actor.id, character: action.character, kind: 'action' };
    const others = this.alivePlayers().filter((p) => p.id !== actor.id).map((p) => p.id); // anyone may counter, target included
    const fail = { k: 'actionFail' };
    switch (type) {
      case 'businesswoman': this.pending.bw = { claim, taxers: [], acted: [], resolved: [], proven: false }; return this.bwOpenTax();
      case 'police':
        if (target.id === actor.id) return this.openChallengeWindow(claim, { k: 'policeLook' }, fail);
        return this.openReactionWindow({ claim, block: { kind: 'block', character: 'police', eligible: others } }, { onProceed: { k: 'policeLook' }, onFail: fail, onBlocked: { k: 'blockedBy', character: 'police', what: 'inspection', after: { k: 'policeLook' } } });
      case 'terrorist': {
        const kill = { k: 'kill', targetId: target.id, reason: 'terrorist', canPay: false, then: { k: 'endTurn' } };
        return this.openReactionWindow({ claim, block: { kind: 'block', character: 'colonel', eligible: others } }, { onProceed: kill, onFail: fail, onBlocked: { k: 'blockedBy', character: 'colonel', what: 'kill', after: kill } });
      }
      case 'thief':
        return this.openReactionWindow({ claim, block: { kind: 'block', character: 'thief', eligible: others } }, { onProceed: { k: 'steal' }, onFail: fail, onBlocked: { k: 'blockedBy', character: 'thief', what: 'theft', after: { k: 'steal' } } });
      default: // taxman, colonel, politician: not blockable
        return this.openChallengeWindow(claim, { k: 'resolveClaim' }, fail);
    }
  }

  /**
   * Business Woman: take 4; every other player may claim Tax Man **at the same time** to skim 1 coin each.
   * One collection window: each eligible player skims / passes / calls the BW bluff. When it closes the
   * Business Woman may call the bluff on every Tax Man that skimmed (bwResolveTax → bwNextChallenge).
   */
  bwOpenTax() {
    if (this.phase !== 'playing') return;
    const bw = this.pending.bw;
    const actor = this.player(bw.claim.claimerId);
    if (!actor.alive) return this.bwPayout();
    const eligible = this.alivePlayers().filter((p) => p.id !== actor.id && !bw.acted.includes(p.id)).map((p) => p.id);
    if (eligible.length === 0) return this.bwResolveTax();
    const claim = bw.proven ? null : bw.claim;
    const w = {
      type: 'reaction', multiTax: true, claim,
      block: { kind: 'tax', character: 'taxman', eligible: eligible.slice() },
      challengeEligible: claim ? eligible.slice() : [], blockEligible: eligible.slice(),
      eligible: eligible.slice(), passed: [], taxers: bw.taxers, challengerId: null, blockerId: null,
      cb: { onProceed: { k: 'bwProvenReopen' }, onFail: { k: 'actionFail' }, onBlocked: null },
    };
    this.pending.window = w;
    this.setDue(this.T.block, { k: 'bwResolveTax' }); w.deadline = this.deadline;
    this.sync();
  }
  /** All skims collected — the Business Woman may now call the bluff on the Tax Men, several at once. */
  bwResolveTax() {
    if (this.phase !== 'playing') return;
    const bw = this.pending.bw; const actor = this.player(bw.claim.claimerId);
    if (!actor.alive) return this.bwPayout();
    return this.bwOpenMultiChallenge();
  }
  /**
   * One window listing every still-unresolved Tax Man. The Business Woman may call the bluff on any of
   * them (challengeTarget); each resolves independently. Unchallenged skims are kept when the timer ends.
   */
  bwOpenMultiChallenge() {
    if (this.phase !== 'playing') return;
    const bw = this.pending.bw; const actor = this.player(bw.claim.claimerId);
    if (!actor || !actor.alive) return this.bwPayout();
    const targets = bw.taxers.filter((id) => !bw.resolved.includes(id) && (() => { const p = this.player(id); return p && p.alive; })());
    if (targets.length === 0) return this.bwPayout();
    // Anyone alive may call the bluff on a skimming Tax Man (a player can't challenge their own skim).
    const everyone = this.alivePlayers().map((p) => p.id);
    const w = {
      type: 'reaction', bwMulti: true, claim: null, block: null,
      targets: targets.map((id) => ({ id, character: 'taxman' })),
      challengeEligible: everyone.slice(), blockEligible: [], eligible: everyone.slice(), passed: [], taxers: [],
      challengerId: null, blockerId: null,
      cb: { onProceed: { k: 'bwPayout' }, onFail: null, onBlocked: null },
    };
    this.pending.window = w;
    this.setDue(this.T.challenge, TIMEOUT); w.deadline = this.deadline;
    this.sync();
  }
  bwPayout() {
    const { claim, taxers } = this.pending.bw; const actor = this.player(claim.claimerId);
    if (!actor.alive) { this.addLog('system', 'bw.out', { name: actor.name }); return this.endTurn(); }
    const k = taxers.length, bw = Math.max(0, 4 - k);
    if (k === 0) this.addLog('coins', 'bw.take4', { name: actor.name, gain: this.gainText(actor, 4) });
    else { const parts = taxers.map((id) => { const t = this.player(id); return { name: t.name, gain: t.alive ? this.gainText(t, 1) : { got: 0, n: 1, max: MAX_COINS } }; }); this.addLog('coins', 'bw.taxed', { name: actor.name, kept: bw, gain: this.gainText(actor, bw), parts }); }
    this.endTurn();
  }

  /** Resolve a non-blockable claim that survived (Tax Man wealth tax, Colonel, Politician). */
  resolveClaim() {
    if (this.phase !== 'playing') return;
    const { action } = this.pending; const actor = this.player(action.actorId); const target = action.targetId ? this.player(action.targetId) : null;
    if (!actor.alive) { this.addLog('system', 'actor.out', { name: actor.name }); return this.endTurn(); }
    switch (action.type) {
      case 'taxman': {
        if (!target.alive || target.coins < 1) { this.addLog('coins', 'tax.nothing', { name: target.name }); return this.endTurn(); }
        target.coins -= 1; this.addLog('coins', 'tax.take', { name: actor.name, target: target.name, gain: this.gainText(actor, 1, target.id) }); return this.endTurn();
      }
      case 'colonel': {
        if (!target.alive) { this.addLog('system', 'colonel.targetout', { name: target.name }); return this.endTurn(); }
        if (target.cards.includes(action.guess)) { this.addLog('loss', 'colonel.right', { target: target.name, guess: action.guess }); this.loseSpecificCard(target, action.guess, 'colonel_correct', actor.id); }
        else { this.addLog('loss', 'colonel.wrong', { target: target.name, guess: action.guess, name: actor.name, gain: this.gainText(target, 4) }); this.loseRandomCard(actor, 'wrong_guess', target.id); }
        if (this.checkGameOver()) return; return this.endTurn();
      }
      case 'politician': {
        const n = actor.cards.length; for (const c of actor.cards) this.deck.push(c); actor.cards = []; for (let i = 0; i < n; i++) actor.cards.push(this.deck.shift());
        this.addLog('action', 'politician.swap', { name: actor.name, n }); return this.endTurn();
      }
    }
  }
  doSteal() {
    const { action } = this.pending; const actor = this.player(action.actorId), target = this.player(action.targetId);
    if (!target.alive) { this.addLog('system', 'steal.out', { name: target.name }); return this.endTurn(); }
    const amount = Math.min(2, target.coins); target.coins -= amount;
    this.addLog('coins', 'steal', { name: actor.name, n: amount, target: target.name, gain: this.gainText(actor, amount, target.id) });
    this.endTurn();
  }
  doPoliceLook() {
    const { action } = this.pending; const actor = this.player(action.actorId), target = this.player(action.targetId);
    if (!target.alive || target.cards.length === 0) { this.addLog('system', 'police.nocards', { name: target.name }); return this.endTurn(); }
    const slot = Math.min(action.slot, target.cards.length - 1); const card = target.cards[slot];
    this.addLog('action', target.id === actor.id ? 'police.look.self' : 'police.look', { name: actor.name, slot: slot + 1, target: target.name });
    this.openDecision(actor.id, 'police', { targetId: target.id, slot, card }, { k: 'policeChoice' }, { k: 'policeKeep' });
  }
  policeChoice(choice) {
    const { action } = this.pending; const actor = this.player(action.actorId), target = this.player(action.targetId);
    const slot = Math.min(action.slot, Math.max(0, target.cards.length - 1));
    if (choice && choice.swap) {
      if (target.alive && target.cards.length > slot) { const old = target.cards[slot]; target.cards[slot] = this.deck.shift(); this.deck.push(old); }
      this.addLog('action', 'police.swap', { name: actor.name });
    } else this.addLog('action', 'police.keep', { name: actor.name });
    this.endTurn();
  }
  /** Kill one card of `targetId`; the target secretly chooses which. opts.canPay: Paid Kill (pay 9 to survive). */
  doKill(targetId, reason, opts, then) {
    const t = this.player(targetId); const killerId = this.pending && this.pending.action ? this.pending.action.actorId : null;
    if (!t.alive) { this.addLog('system', 'kill.out', { name: t.name }); return this.run(then); }
    const canPay = !!(opts && opts.canPay) && t.coins >= 9;
    if (!canPay && t.cards.length === 1) { this.loseCardAt(t, 0, reason, killerId); if (this.checkGameOver()) return; return this.run(then); }
    this.openDecision(t.id, 'lose_card', { reason, canPay, payCost: 9 }, { k: 'killChoice', targetId, reason, canPay, then }, { k: 'killTimeout', targetId, reason, then });
  }
  killChoice(c, choice) {
    const t = this.player(c.targetId); const killerId = this.pending && this.pending.action ? this.pending.action.actorId : null;
    if (c.canPay && choice.pay) { this.pay(t, 9); this.addLog('coins', 'kill.survive', { name: t.name, reason: c.reason }); return this.run(c.then); }
    const idx = Number.isInteger(choice.index) ? choice.index : Math.floor(Math.random() * t.cards.length);
    this.loseCardAt(t, idx, c.reason, killerId);
    if (this.checkGameOver()) return;
    this.run(c.then);
  }

  // ───────────────────────── windows ─────────────────────────
  closeWindow() { const w = this.pending ? this.pending.window : null; if (this.pending) this.pending.window = null; return w; }
  /**
   * Unified reaction window. spec.claim may be challenged by any other player; spec.block may be claimed by an eligible player.
   * cbs = { onProceed, onFail, onBlocked } continuation descriptors.
   */
  openReactionWindow(spec, cbs) {
    if (this.phase !== 'playing') return;
    const claim = spec.claim || null;
    const block = spec.block ? { ...spec.block, eligible: spec.block.eligible.filter((id) => { const p = this.player(id); return p && p.alive && p.connected; }) } : null;
    const exclude = spec.challengeExclude || []; // players who already reacted (skimmed/declined) don't get re-prompted
    const challengeEligible = claim ? this.alivePlayers().filter((p) => p.id !== claim.claimerId && p.connected && !exclude.includes(p.id)).map((p) => p.id) : [];
    const blockEligible = block ? block.eligible : [];
    const eligible = [...new Set([...challengeEligible, ...blockEligible])];
    if (eligible.length === 0) return this.run(cbs.onProceed);
    const w = { type: 'reaction', claim, block, challengeEligible, blockEligible, eligible, passed: [], challengerId: null, blockerId: null, cb: { onProceed: cbs.onProceed || null, onFail: cbs.onFail || null, onBlocked: cbs.onBlocked || null } };
    this.pending.window = w;
    this.setDue(claim ? this.T.challenge : this.T.block, TIMEOUT); w.deadline = this.deadline;
    this.sync();
  }
  openChallengeWindow(claim, onSurvive, onFail) { this.openReactionWindow({ claim }, { onProceed: onSurvive, onFail }); }
  openBlockWindow(spec, onNoBlock, onBlocked) { this.openReactionWindow({ block: spec }, { onProceed: onNoBlock, onBlocked }); }

  /** Call the bluff on the pending claim. First challenger wins. */
  challenge(playerId) {
    if (this.phase !== 'playing') throw new GameError('Game is not running');
    const w = this.pending && this.pending.window;
    if (!w || w.type !== 'reaction' || !w.claim) throw new GameError('Nothing to challenge right now');
    if (w.challengerId) throw new GameError(`${this.name(w.challengerId)} already challenged`);
    if (!w.challengeEligible.includes(playerId)) throw new GameError('You cannot challenge this claim');
    if (w.multiTax && !this.pending.bw.acted.includes(playerId)) this.pending.bw.acted.push(playerId); // challenging the BW counts as reacting
    w.challengerId = playerId; w.challengedAt = this.now();
    this.clearDue();
    const claimer = this.player(w.claim.claimerId), challenger = this.player(playerId), ch = w.claim.character, cbs = w.cb, block = w.multiTax ? null : w.block;
    this.closeWindow();
    if (claimer.cards.includes(ch)) {
      if (w.claim.kind === 'action' && this.pending.bw) this.pending.bw.proven = true;
      this.addLog('challenge', 'bluff.true', { challenger: challenger.name, name: claimer.name, character: ch });
      this.flash = { playerId: claimer.id, character: ch, ts: this.now() };
      this.event('reveal', { playerId: claimer.id, character: ch, challengerId: challenger.id });
      const idx = claimer.cards.indexOf(ch); claimer.cards.splice(idx, 1); this.deck.push(ch); claimer.cards.push(this.deck.shift());
      this.addLog('reveal', 'bluff.replace', { name: claimer.name, character: ch });
      this.loseRandomCard(challenger, 'lost_challenge', claimer.id);
      if (this.checkGameOver()) return;
      this.sync();
      this.pause('challenge', { result: 'true', claimerId: claimer.id, challengerId: challenger.id, character: ch }, block ? { k: 'reopenBlock', block, cbs } : cbs.onProceed);
    } else {
      this.addLog('challenge', 'bluff.caught', { challenger: challenger.name, name: claimer.name, character: ch });
      this.event('bluff', { playerId: claimer.id, character: ch, challengerId: challenger.id });
      this.loseRandomCard(claimer, 'caught_bluffing', challenger.id);
      if (this.checkGameOver()) return;
      this.sync();
      this.pause('challenge', { result: 'bluff', claimerId: claimer.id, challengerId: challenger.id, character: ch }, cbs.onFail);
    }
  }
  /** Business Woman calls the bluff on one specific Tax Man in the multi-challenge window. */
  challengeTarget(playerId, targetId) {
    if (this.phase !== 'playing') throw new GameError('Game is not running');
    const w = this.pending && this.pending.window;
    if (!w || w.type !== 'reaction' || !w.bwMulti) throw new GameError('Nothing to challenge right now');
    const bw = this.pending.bw;
    if (!bw) throw new GameError('Nothing to challenge right now');
    if (playerId === targetId) throw new GameError('You cannot challenge your own skim');
    if (!w.challengeEligible || !w.challengeEligible.includes(playerId)) throw new GameError('You cannot challenge this');
    const idx = w.targets.findIndex((t) => t.id === targetId);
    if (idx < 0) throw new GameError('That player is not skimming');
    const taxer = this.player(targetId);
    if (!taxer || !taxer.alive) throw new GameError('That player is out');
    const character = 'taxman';
    bw.resolved.push(targetId);
    this.clearDue(); this.closeWindow();
    if (taxer.cards.includes(character)) { // true claim — taxer keeps the skim, the Business Woman loses a card
      this.addLog('challenge', 'bluff.true', { challenger: this.name(playerId), name: taxer.name, character });
      this.flash = { playerId: taxer.id, character, ts: this.now() };
      this.event('reveal', { playerId: taxer.id, character, challengerId: playerId });
      const i = taxer.cards.indexOf(character); taxer.cards.splice(i, 1); this.deck.push(character); taxer.cards.push(this.deck.shift());
      this.addLog('reveal', 'bluff.replace', { name: taxer.name, character });
      this.loseRandomCard(this.player(playerId), 'lost_challenge', taxer.id);
      if (this.checkGameOver()) return;
      this.sync();
      this.pause('challenge', { result: 'true', claimerId: taxer.id, challengerId: playerId, character }, { k: 'bwOpenMultiChallenge' });
    } else { // caught — void this skim, the Tax Man loses a card
      const ti = bw.taxers.indexOf(targetId); if (ti >= 0) bw.taxers.splice(ti, 1);
      this.addLog('challenge', 'bluff.caught', { challenger: this.name(playerId), name: taxer.name, character });
      this.event('bluff', { playerId: taxer.id, character, challengerId: playerId });
      this.loseRandomCard(taxer, 'caught_bluffing', playerId);
      if (this.checkGameOver()) return;
      this.sync();
      this.pause('challenge', { result: 'bluff', claimerId: taxer.id, challengerId: playerId, character }, { k: 'bwOpenMultiChallenge' });
    }
  }
  /** Block / veto / tax by claiming the blocking character. */
  block(playerId) {
    if (this.phase !== 'playing') throw new GameError('Game is not running');
    const w = this.pending && this.pending.window;
    if (!w || w.type !== 'reaction' || !w.block) throw new GameError('Nothing to block right now');
    if (!w.blockEligible.includes(playerId)) throw new GameError('You cannot block this action');
    if (w.multiTax) { // many Tax Men skim in the same window; it stays open until everyone reacts
      const bw = this.pending.bw;
      bw.acted.push(playerId); bw.taxers.push(playerId);
      w.eligible = w.eligible.filter((id) => id !== playerId);
      w.blockEligible = w.blockEligible.filter((id) => id !== playerId);
      w.challengeEligible = w.challengeEligible.filter((id) => id !== playerId);
      this.addLog('block', 'bw.taxclaim', { name: this.name(playerId), target: this.name(bw.claim.claimerId) });
      this.event('block', { playerId, actorId: this.pending.actorId, kind: 'tax', character: 'taxman' });
      if (w.eligible.length === 0) { this.clearDue(); return this.run({ k: 'bwResolveTax' }); }
      return this.sync();
    }
    if (w.blockerId) throw new GameError('Already blocked');
    w.blockerId = playerId; this.clearDue();
    const cbs = w.cb;
    this.event('block', { playerId, actorId: this.pending.actorId, kind: w.block.kind, character: w.block.character });
    this.closeWindow();
    this.run(cbs.onBlocked, playerId, w);
  }
  /** Decline to react. When everyone eligible has passed, the window closes early. */
  pass(playerId) {
    if (this.phase !== 'playing') return;
    const w = this.pending && this.pending.window;
    if (!w || w.type !== 'reaction') return;
    if (!w.eligible.includes(playerId)) return;
    if (w.multiTax) {
      const bw = this.pending.bw;
      bw.acted.push(playerId); w.passed.push(playerId);
      w.eligible = w.eligible.filter((id) => id !== playerId);
      w.blockEligible = w.blockEligible.filter((id) => id !== playerId);
      w.challengeEligible = w.challengeEligible.filter((id) => id !== playerId);
      if (w.eligible.length === 0) { this.clearDue(); return this.run({ k: 'bwResolveTax' }); }
      return this.sync();
    }
    if (w.passed.includes(playerId)) return;
    w.passed.push(playerId);
    if (w.eligible.every((id) => w.passed.includes(id))) { this.clearDue(); this.run(TIMEOUT); } else this.sync();
  }
  openDecision(playerId, kind, data, onChoice, onTimeout) {
    if (this.phase !== 'playing') return;
    const p = this.player(playerId);
    const w = { type: 'decision', kind, playerId, data, cb: { onChoice, onTimeout } };
    this.pending.window = w;
    this.setDue(p.connected ? this.T.decision : this.T.disconnectedDecision, TIMEOUT); w.deadline = this.deadline;
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
    this.clearDue();
    const { onChoice } = w.cb; this.closeWindow();
    this.run(onChoice, choice || {});
  }

  // ───────────────────────── connectivity / cosmetics ─────────────────────────
  setProfile(playerId, { avatar, color }) { const p = this.player(playerId); if (!p) return; if (avatar) p.avatar = avatar; if (color) p.color = color; this.sync(); }
  setConnected(playerId, connected) {
    const p = this.player(playerId); if (!p || p.connected === connected) return;
    p.connected = connected;
    if (this.phase !== 'playing') return this.sync();
    const pend = this.pending;
    if (!connected && pend) {
      if (pend.stage === 'turn' && pend.actorId === playerId && this.deadline != null) {
        if (this.deadline - this.now() > this.T.disconnectedTurn) { this.setDue(this.T.disconnectedTurn, { k: 'turnTimeout', actorId: playerId }); pend.deadline = this.deadline; }
      } else if (pend.window) {
        const w = pend.window;
        if (w.type === 'reaction' && w.eligible.includes(playerId)) return this.pass(playerId); // a disconnected player is treated as passing
        if (w.type === 'decision' && w.playerId === playerId && this.deadline - this.now() > this.T.disconnectedDecision) { this.setDue(this.T.disconnectedDecision, TIMEOUT); w.deadline = this.deadline; }
      }
    }
    this.sync();
  }

  // ───────────────────────── per-player view (never leaks hidden cards) ─────────────────────────
  viewFor(playerId) {
    const me = this.player(playerId); const pend = this.pending; const w = pend && pend.window; const now = this.now();
    let window = null;
    if (w) {
      window = { type: w.type, deadline: w.deadline || null, eligible: w.eligible || [], passed: w.passed || [], taxers: w.taxers || [], multiTax: !!w.multiTax, bwMulti: !!w.bwMulti, targets: w.targets ? w.targets.map((t) => ({ id: t.id, character: t.character })) : [], claim: w.claim ? { claimerId: w.claim.claimerId, character: w.claim.character, kind: w.claim.kind } : null, block: w.block ? { kind: w.block.kind, character: w.block.character, eligible: w.block.eligible } : null, challengeEligible: w.challengeEligible || [], blockEligible: w.blockEligible || [], kind: w.kind || null, playerId: w.playerId || null };
      if (w.type === 'decision' && w.playerId === playerId) window.data = w.data; // private (e.g. police peek)
      if (w.type === 'result') window.data = w.data; // public outcome summary
    }
    return {
      phase: this.phase, winnerId: this.winnerId, serverTime: now, timings: this.T, maxCoins: MAX_COINS, handSize: this.handSize, deckSize: this.deck.length,
      turnPlayerId: this.phase === 'playing' ? this.active.id : null,
      players: this.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat, coins: p.coins, isBot: p.isBot, avatar: p.avatar, color: p.color, cardCount: p.cards.length, alive: p.alive, connected: p.connected })),
      you: me ? { id: me.id, cards: me.cards.slice(), alive: me.alive, coins: me.coins } : null,
      log: this.log.slice(-120), events: this.events.slice(-40),
      flash: this.flash && now - this.flash.ts < 6000 ? this.flash : null,
      nextDue: this.nextDue(),
      pending: pend ? { stage: pend.stage, actorId: pend.actorId, logStart: pend.logStart || 0, deadline: pend.stage === 'turn' ? pend.deadline : null, action: pend.action ? { type: pend.action.type, actorId: pend.action.actorId, targetId: pend.action.targetId, guess: pend.action.guess, character: pend.action.character } : null, window } : null,
    };
  }
}
