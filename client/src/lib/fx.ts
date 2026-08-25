/* Visual effects driven by server events. They work on the DOM through data attributes so React stays declarative:
   seats expose data-seat="<playerId>" and data-coins, the bank is #bank, the effects layer is #fx. */
import { IMG, CH } from '../theme';
import { sfx } from './sfx';
import { store } from './store';
import { t } from '../i18n';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fxRoot = () => document.getElementById('fx') as HTMLElement;
const rectOf = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; };
const seatEl = (pid: string) => document.querySelector(`[data-seat="${CSS.escape(pid)}"]`);
const coinsElOf = (pid: string) => document.querySelector(`[data-seat="${CSS.escape(pid)}"] [data-coins]`);
const bankEl = () => document.getElementById('bank') || document.getElementById('deck');
function anchor(id: string) { return rectOf(id === 'bank' ? bankEl() : coinsElOf(id) || seatEl(id)) || { x: window.innerWidth / 2, y: window.innerHeight / 2 }; }

function bump(el: Element | null) { if (!el) return; el.classList.remove('bump'); void (el as HTMLElement).offsetWidth; el.classList.add('bump'); }
function shake(el: Element | null) { if (!el) return; el.classList.remove('shake'); void (el as HTMLElement).offsetWidth; el.classList.add('shake'); setTimeout(() => el.classList.remove('shake'), 500); }
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
    ], { duration: reducedMotion ? 1 : 700 + i * 80, delay: i * 55, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'forwards' }).onfinish = () => { c.remove(); bump(coinsElOf(toId)); };
  }
}
export function flyCard(fromId: string) {
  const a = anchor(fromId), b = rectOf(bankEl()) || anchor('bank'); const fx = fxRoot();
  sfx.play('card');
  const c = document.createElement('div'); c.className = 'fx-card'; fx.appendChild(c);
  c.animate([{ transform: `translate(${a.x - 20}px, ${a.y - 33}px) rotate(0deg)`, opacity: 1 }, { transform: `translate(${b.x - 20}px, ${b.y - 33}px) rotate(540deg) scale(.5)`, opacity: 0.2 }], { duration: reducedMotion ? 1 : 800, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' }).onfinish = () => c.remove();
  shake(seatEl(fromId));
}
export function stamp(pid: string, text: string, cls = '') {
  const a = anchor(pid); const s = document.createElement('div'); s.className = 'fx-stamp ' + cls; s.textContent = text; s.style.left = a.x + 'px'; s.style.top = (a.y - 10) + 'px'; fxRoot().appendChild(s);
  sfx.play('stamp'); setTimeout(() => s.remove(), 3600);
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
    c.animate([{ transform: 'translateY(0) rotate(0)', opacity: 1 }, { transform: `translateY(${window.innerHeight + 40}px) rotate(${720 + Math.random() * 720}deg) translateX(${(Math.random() - 0.5) * 200}px)`, opacity: 0.9 }], { duration: 2500 + Math.random() * 2000, delay: Math.random() * 800, easing: 'cubic-bezier(.2,.6,.4,1)', fill: 'forwards' }).onfinish = () => c.remove();
  }
}
let bannerTimer: any = null;
export function banner(text: string) {
  const id = Date.now(); store.set({ banner: { text, id } });
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { if (store.get().banner?.id === id) store.set({ banner: null }); }, 2000);
}

let lastEventId: number | null = null;
export function resetEvents() { lastEventId = null; }
export function processEvents(s: { events?: any[] }, me: string | null) {
  const evs = s.events || [];
  if (lastEventId === null) { lastEventId = evs.length ? evs[evs.length - 1].id : 0; return; } // don't replay history on (re)join
  const fresh = evs.filter((e) => e.id > (lastEventId as number));
  if (!fresh.length) return;
  lastEventId = fresh[fresh.length - 1].id;
  const elimIds = new Set(fresh.filter((e) => e.type === 'eliminated').map((e) => e.playerId)); // don't double up card-loss + death
  fresh.forEach((e, i) => setTimeout(() => {
    switch (e.type) {
      case 'coins': flyCoins(e.from, e.to, e.n); break;
      case 'coup': sfx.clip('coup'); break;                       // someone paid 7 to strike
      case 'card_lost':
        flyCard(e.playerId); cameraShake(document.getElementById('table'));
        if (e.playerId === me) shake(document.getElementById('console'));
        if (!elimIds.has(e.playerId)) sfx.clip(e.playerId === me ? 'cardloss' : 'cardkill'); // you lose one vs. you knock one out
        break;
      case 'reveal': reveal(e.character); cameraShake(document.getElementById('table'), true); stamp(e.playerId, t('stamp.true'), 'ok'); setTimeout(() => stamp(e.challengerId, t('stamp.wrong')), 600); break;
      case 'bluff': stamp(e.playerId, t('stamp.bluff')); cameraShake(document.getElementById('table'), true); sfx.clip('bluff'); break;
      case 'block': stamp(e.playerId, t(e.kind === 'veto' ? 'stamp.veto' : e.kind === 'tax' ? 'stamp.tax' : 'stamp.blocked'), 'blue'); if (e.actorId === me) sfx.clip('blocked'); break;
      case 'eliminated': stamp(e.playerId, t('stamp.out'), ''); cameraShake(document.getElementById('table'), true); sfx.clip('death'); break;
      case 'win': if (e.playerId === me) { confetti(); sfx.play('win'); } else sfx.play('lose'); break;
    }
  }, i * 350));
}
