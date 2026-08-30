/* Visual effects driven by server events. They work on the DOM through data attributes so React stays declarative:
   seats expose data-seat="<playerId>" and data-coins, the bank is #bank, the effects layer is #fx. */
import { ACTION_CARDS, IMG, CH } from '../theme';
import { sfx } from './sfx';
import { store } from './store';
import { i18n, t } from '../i18n';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fxRoot = () => document.getElementById('fx') as HTMLElement;
const rectOf = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
const seatEl = (pid: string) => document.querySelector(`[data-seat="${CSS.escape(pid)}"]`);
const coinsElOf = (pid: string) => document.querySelector(`[data-seat="${CSS.escape(pid)}"] [data-coins]`);
const bankEl = () => document.getElementById('bank') || document.getElementById('deck');
function anchor(id: string) { return rectOf(id === 'bank' ? bankEl() : coinsElOf(id) || seatEl(id)) || { x: window.innerWidth / 2, y: window.innerHeight / 2 }; }

function bump(el: Element | null) { if (!el) return; el.classList.remove('bump'); void (el as HTMLElement).offsetWidth; el.classList.add('bump'); }
function shake(el: Element | null) { if (!el) return; el.classList.remove('shake'); void (el as HTMLElement).offsetWidth; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 500); }
/** Flash a highlight on a player's seat: 'hit' (lost a card / caught lying) or 'out' (eliminated). */
function flashSeat(pid: string, kind: 'hit' | 'out') {
  const el = seatEl(pid); if (!el) return;
  const cls = 'seat-fx-' + kind; el.classList.remove(cls); void (el as HTMLElement).offsetWidth; el.classList.add(cls);
  if (kind === 'hit') setTimeout(() => el.classList.remove(cls), 900);
}
/** Camera shake on a non-centered element (the table / console) for big beats. */
function cameraShake(el: Element | null, big = false) {
  if (!el || reducedMotion) return; const cls = big ? 'cam-shake-lg' : 'cam-shake';
  el.classList.remove(cls); void (el as HTMLElement).offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 500);
}

export function flyCoins(fromId: string, toId: string, n: number) {
  const a = anchor(fromId), b = anchor(toId); const count = Math.min(n, 8); const fx = fxRoot();
  sfx.play('coin');
  for (let i = 0; i < count; i++) {
    const c = document.createElement('img'); c.className = 'fx-coin'; c.src = IMG.coin; fx.appendChild(c);
    const dx = (Math.random() - 0.5) * 34, dy = (Math.random() - 0.5) * 30; const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
    c.animate([
      { transform: `translate(${a.x - 13 + dx}px, ${a.y - 13 + dy}px) scale(.6) rotate(0deg)`, opacity: 0 },
      { transform: `translate(${a.x - 13 + dx}px, ${a.y - 13 + dy}px) scale(1) rotate(${spin * 0.15}deg)`, opacity: 1, offset: 0.15 },
      { transform: `translate(${(a.x + b.x) / 2 - 13}px, ${Math.min(a.y, b.y) - 64}px) scale(1.12) rotate(${spin * 0.55}deg)`, offset: 0.55 },
      { transform: `translate(${b.x - 13}px, ${b.y - 13}px) scale(.7) rotate(${spin}deg)`, opacity: 1 },
    ], { duration: reducedMotion ? 1 : 700 + i * 80, delay: i * 55, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'both' }).onfinish = () => { c.remove(); bump(coinsElOf(toId)); };
  }
}
export function flyCard(fromId: string, mine = false) {
  const a = anchor(fromId), b = rectOf(bankEl()) || anchor('bank'); const fx = fxRoot();
  sfx.play('card');
  // impact ring bursting out of the seat that just lost the card
  if (!reducedMotion) {
    const ring = document.createElement('div'); ring.className = 'fx-ring'; fx.appendChild(ring);
    ring.animate([
      { transform: `translate(${a.x - 40}px, ${a.y - 40}px) scale(.3)`, opacity: 0.9 },
      { transform: `translate(${a.x - 40}px, ${a.y - 40}px) scale(1.7)`, opacity: 0 },
    ], { duration: 650, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'forwards' }).onfinish = () => ring.remove();
  }
  // The lost card's identity stays SECRET: only its back rises centre-stage (so everyone
  // notices a card was lost), then it flies back onto the deck unseen.
  {
    const cx = window.innerWidth / 2, cy = window.innerHeight / 2 - 30;
    const el = document.createElement('div'); el.className = 'fx-lost'; fx.appendChild(el);
    const D = reducedMotion ? 1 : 1600;
    el.animate([
      { transform: `translate(${a.x - 55}px, ${a.y - 90}px) scale(.4) rotate(-8deg)`, opacity: 0, easing: 'cubic-bezier(.2,.7,.3,1)' }, // out of the seat
      { transform: `translate(${cx - 55}px, ${cy - 90}px) scale(1) rotate(0deg)`, opacity: 1, offset: 0.3, easing: 'linear' },          // centre stage
      { transform: `translate(${cx - 55}px, ${cy - 90}px) scale(1) rotate(0deg)`, opacity: 1, offset: 0.6, easing: 'ease-in' },         // brief hold
      { transform: `translate(${b.x - 55}px, ${b.y - 90}px) scale(.3) rotate(320deg)`, opacity: 0.1 },                                  // onto the deck
    ], { duration: D, fill: 'forwards' }).onfinish = () => el.remove();
  }
  // losing your OWN card stings: brief red vignette over the whole screen
  if (mine && !reducedMotion) {
    const v = document.createElement('div'); v.className = 'fx-vignette'; fx.appendChild(v);
    v.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'forwards' }).onfinish = () => v.remove();
  }
  shake(seatEl(fromId));
  flashSeat(fromId, 'hit');
}
/**
 * One centre-stage presenter for every beat that matters — a hit, a lost card, an elimination, a
 * swap. They used to be told in four different places and at four different sizes (a seat stamp
 * here, a small flying card there), so half of them were missed entirely. Same spot, same size,
 * same timing: whatever just happened, you look at the middle of the board and you see it.
 */
export function headline(text: string, kind: 'hit' | 'out' | 'swap' | 'coup', art?: string) {
  const d = document.createElement('div');
  d.className = `fx-head k-${kind}`;
  d.innerHTML = `${art ? `<img src="${art}" alt="" />` : ''}<b>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}</b>`;
  fxRoot().appendChild(d);
  d.animate([
    { transform: 'translate(-50%, -46%) scale(.86)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.16 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.74 },
    { transform: 'translate(-50%, -56%) scale(.97)', opacity: 0 },
  ], { duration: reducedMotion ? 1 : 1700, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }).onfinish = () => d.remove();
}

/**
 * The reel: `n` cards slide from a seat back UNDER the deck, then `n` fresh ones deal out to that
 * seat on a stagger. Card identity never leaks — both legs are card backs, which is also the truth:
 * nobody at the table sees what was traded.
 */
export function swapCards(pid: string, n: number) {
  // NB every animate() below is fill:'both'. With a delay, fill:'forwards' leaves the element at its
  // untransformed position — a stack of card backs flashing in the corner before they jump.
  const a = anchor(pid), deck = rectOf(bankEl()) || anchor('bank');
  const fx = fxRoot();
  const count = Math.max(1, Math.min(n, 3));
  sfx.play('deal');
  for (let i = 0; i < count; i++) {
    // leg 1: hand → under the deck
    const back = document.createElement('div'); back.className = 'fx-deal'; fx.appendChild(back);
    back.animate([
      { transform: `translate(${a.x - 27}px, ${a.y - 22}px) scale(.9) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${deck.x - 27}px, ${deck.y - 22}px) scale(.72) rotate(${-16 - i * 6}deg)`, opacity: .25 },
    ], { duration: reducedMotion ? 1 : 420, delay: i * 90, easing: 'cubic-bezier(.4,.1,.7,1)', fill: 'both' }).onfinish = () => back.remove();

    // leg 2: deck → hand, after the returns have landed
    const dealt = document.createElement('div'); dealt.className = 'fx-deal'; fx.appendChild(dealt);
    dealt.animate([
      { transform: `translate(${deck.x - 27}px, ${deck.y - 22}px) scale(.7) rotate(0deg)`, opacity: 0 },
      { transform: `translate(${deck.x - 27}px, ${deck.y - 22}px) scale(.82) rotate(0deg)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${a.x - 27}px, ${a.y - 22}px) scale(1) rotate(${8 - i * 8}deg)`, opacity: 1 },
    ], { duration: reducedMotion ? 1 : 520, delay: 380 + i * 110, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' })
      .onfinish = () => { dealt.remove(); bump(seatEl(pid)); };
  }
}

export function stamp(pid: string, text: string, cls = '') {
  const a = anchor(pid); const s = document.createElement('div'); s.className = 'fx-stamp ' + cls; s.textContent = text; s.style.left = a.x + 'px'; s.style.top = (a.y - 10) + 'px'; fxRoot().appendChild(s);
  sfx.play('stamp'); setTimeout(() => s.remove(), 3600);
}
let localPlayAt = 0; // when I last flashed my OWN move optimistically, so the server echo doesn't repeat it
/** Flash the card that was just played — character claims AND the basic action cards.
    `local` = fired from my own click, before the server has echoed it back. */
export function playedCard(type: string, local = false) {
  if (local) localPlayAt = Date.now();
  const src = CH[type as keyof typeof CH]?.card || ACTION_CARDS[type];
  if (!src) return;
  sfx.play('play');
  const d = document.createElement('div'); d.className = 'fx-played';
  d.innerHTML = `<img src="${src}" alt="" />`;
  fxRoot().appendChild(d);
  d.animate([
    { transform: 'translate(-50%, -50%) scale(.7) rotate(-6deg)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.22 },
    { transform: 'translate(-50%, -50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.7 },
    { transform: 'translate(-50%, -62%) scale(.92) rotate(2deg)', opacity: 0 },
  ], { duration: reducedMotion ? 1 : 1500, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }).onfinish = () => d.remove();
}

export function reveal(character: string) {
  const d = document.createElement('div'); d.className = 'fx-reveal gcard flip';
  d.innerHTML = `<div class="inner"><div class="face back"></div><div class="face front"><img src="${CH[character as keyof typeof CH].card}" alt="" /></div></div>`; fxRoot().appendChild(d);
  sfx.play('reveal'); requestAnimationFrame(() => setTimeout(() => d.classList.add('flipped'), 80)); setTimeout(() => d.remove(), 2700);
}
export function confetti() {
  if (reducedMotion) return; const colors = ['#B7873F', '#E9C983', '#F7B750', '#E5661A', '#C0403A', '#EFE3C8']; const fx = fxRoot();
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('div'); c.className = 'fx-confetti'; c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % colors.length]; fx.appendChild(c);
    c.animate([{ transform: 'translateY(0) rotate(0)', opacity: 1 }, { transform: `translateY(${window.innerHeight + 40}px) rotate(${720 + Math.random() * 720}deg) translateX(${(Math.random() - 0.5) * 200}px)`, opacity: 0.9 }], { duration: 2500 + Math.random() * 2000, delay: Math.random() * 800, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'both' }).onfinish = () => c.remove();
  }
}
let bannerTimer: any = null;
export function banner(text: string, cls = '') {
  const id = Date.now(); store.set({ banner: { text, id, cls } });
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { if (store.get().banner?.id === id) store.set({ banner: null }); }, 2000);
}

const nameOf = (id: string) => (store.get().state?.players.find((p) => p.id === id) || ({} as any)).name || '?';

let lastEventId: number | null = null;
export function resetEvents() { lastEventId = null; }
export function processEvents(s: { events?: any[] }, me: string | null) {
  const evs = s.events || [];
  if (lastEventId === null) { lastEventId = evs.length ? evs[evs.length - 1].id : 0; return; } // don't replay history on (re)join
  const fresh = evs.filter((e) => e.id > (lastEventId as number));
  if (!fresh.length) return;
  lastEventId = fresh[fresh.length - 1].id;
  fresh.forEach((e, i) => setTimeout(() => {
    switch (e.type) {
      case 'coins': flyCoins(e.from, e.to, e.n); break;
      case 'play': if (e.playerId !== me || Date.now() - localPlayAt > 4000) playedCard(e.move); break; // a basic move: the card is the announcement
      case 'coup':
        sfx.play('boom'); cameraShake(document.getElementById('table'), true);
        headline(t('head.coup', { name: nameOf(e.playerId), target: nameOf(e.targetId) }), 'coup', ACTION_CARDS.paidkill);
        break;
      case 'card_lost':
        flyCard(e.playerId, e.playerId === me); cameraShake(document.getElementById('table'));
        headline(e.playerId === me ? t('head.hitMe') : t('head.hit', { name: nameOf(e.playerId) }), 'hit');
        if (e.playerId === me) shake(document.getElementById('console'));
        break;
      // cards traded: back under the deck, fresh ones dealt out — see swapCards
      case 'swap':
        swapCards(e.playerId, e.n || 1);
        headline(e.playerId === me ? t('head.swapMe', { n: e.n || 1 }) : t('head.swap', { name: nameOf(e.playerId), n: e.n || 1 }), 'swap');
        break;
      case 'reveal': reveal(e.character); cameraShake(document.getElementById('table'), true); stamp(e.playerId, t('stamp.true'), 'ok'); setTimeout(() => stamp(e.challengerId, t('stamp.wrong')), 600); break;
      // Colonel called a card on somebody: show the guessed card to the whole table, say who/at whom,
      // then stamp the guesser TRUE!/WRONG!. The card_lost that follows keeps the real hand secret.
      case 'guess': {
        banner(t('banner.guess', { name: nameOf(e.playerId), character: i18n.charName(e.character), target: nameOf(e.targetId) }), 'sm');
        reveal(e.character); cameraShake(document.getElementById('table'), true);
        setTimeout(() => stamp(e.playerId, t(e.right ? 'stamp.true' : 'stamp.wrong'), e.right ? 'ok' : ''), 600);
        break;
      }
      case 'bluff': sfx.play('bluff'); stamp(e.playerId, t('stamp.bluff')); flashSeat(e.playerId, 'hit'); cameraShake(document.getElementById('table'), true); break;
      case 'block': sfx.play('block'); stamp(e.playerId, t(e.kind === 'veto' ? 'stamp.veto' : e.kind === 'tax' ? 'stamp.tax' : 'stamp.blocked'), 'blue'); break;
      case 'eliminated':
        stamp(e.playerId, t('stamp.out'), ''); flashSeat(e.playerId, 'out');
        headline(e.playerId === me ? t('head.outMe') : t('head.out', { name: nameOf(e.playerId) }), 'out');
        cameraShake(document.getElementById('table'), true); sfx.play('lose');
        break;
      case 'win': if (e.playerId === me) { confetti(); sfx.play('win'); } else sfx.play('lose'); break;
    }
  }, i * 350));
}
