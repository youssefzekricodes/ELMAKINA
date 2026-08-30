/* Guided-play tour: coach-marks that spotlight your cards and the action buttons during a real
   solo game. Active while store.tour is set OR learning mode is on. The dark backdrop is click-through (pointer-events:none)
   so gameplay is never blocked — only the coach card itself is interactive. */
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { isCoaching, needsMe, tableBusy, useStore } from '../lib/store';
import { Icon } from './ui';

// Shown in order; each tip appears the first time its target exists and hasn't been dismissed.
// `all: true` spotlights the union of every matching element (e.g. all your framed cards at once).
const TIPS: { key: string; sel: string; all?: boolean }[] = [
  { key: 'hand', sel: '.board-card.owned', all: true },            // the gold-framed cards = your secret roles
  { key: 'coins', sel: '.me-coins' },
  { key: 'basic', sel: '.board-card[data-kind="default"]', all: true },  // the safe money/coup cards
  { key: 'claims', sel: '.board-card[data-kind="claim"]', all: true },   // the character cards (bluffable)
  { key: 'react', sel: '.cm-btns, .cl-btns' },                     // only exists when I can actually react
  { key: 'result', sel: '.verdict-strip' },                        // shown when a called bluff resolves
];
// The two tips that are ABOUT a live window. Every other tip has to wait for one to finish: the
// spotlight scrims the whole board, so a tip about your hand would black out the claim you are
// supposed to be reacting to.
const LIVE_TIPS = ['react', 'result'];

/** Bounding rect covering every element that matches the selector. */
function unionRect(sel: string): DOMRect | null {
  const els = [...document.querySelectorAll(sel)] as HTMLElement[];
  if (!els.length) return null;
  let l = Infinity, t2 = Infinity, r = -Infinity, b = -Infinity;
  for (const el of els) { const rc = el.getBoundingClientRect(); if (!rc.width) continue; l = Math.min(l, rc.left); t2 = Math.min(t2, rc.top); r = Math.max(r, rc.right); b = Math.max(b, rc.bottom); }
  if (!isFinite(l)) return null;
  return new DOMRect(l, t2, r - l, b - t2);
}

export function Tour() {
  const s = useStore();
  const meP = s.state?.players?.find((p) => p.id === s.me);
  const active = !!(isCoaching(s) && s.screen === 'game' && meP && meP.alive); // guide tour OR learning mode; stop once eliminated / spectating
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [cur, setCur] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The claim panel's box, sampled on the same tick as the target. It has to live in state, not be
  // read during render: React has no idea the panel came or went, so a render that measured it
  // directly would keep showing whatever it saw the last time something else forced a re-render.
  const [panel, setPanel] = useState<{ t: number; b: number; l: number; r: number } | null>(null);

  useEffect(() => {
    if (!active) return;
    const compute = () => {
      const tip = TIPS.find((tp) => !done[tp.key] && document.querySelector(tp.sel));
      if (!tip) { setCur(null); setRect(null); return; }
      const r = tip.all ? unionRect(tip.sel) : (document.querySelector(tip.sel) as HTMLElement | null)?.getBoundingClientRect() ?? null;
      setCur(tip.key);
      const pr = (document.querySelector('.prompt') as HTMLElement | null)?.getBoundingClientRect();
      const box = pr && pr.width ? { t: pr.top, b: pr.bottom, l: pr.left, r: pr.right } : null;
      setPanel((prev) => {
        if (!box || !prev) return box === null && prev === null ? prev : box;
        return Math.abs(box.t - prev.t) < 1 && Math.abs(box.b - prev.b) < 1 && Math.abs(box.l - prev.l) < 1 && Math.abs(box.r - prev.r) < 1 ? prev : box;
      });
      // only push a new rect when it actually moved — a fresh DOMRect every tick restarts the
      // spotlight's CSS transition from zero, so it never reaches its target
      setRect((prev) => {
        if (!r) return null;
        if (prev && Math.abs(prev.left - r.left) < 1 && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1) return prev;
        return r;
      });
    };
    compute();
    const id = window.setInterval(compute, 250);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => { window.clearInterval(id); window.removeEventListener('resize', compute); window.removeEventListener('scroll', compute, true); };
  }, [active, done]);

  if (!active || !cur || !rect) return null;
  if ((tableBusy(s) || needsMe(s)) && !LIVE_TIPS.includes(cur)) return null; // hold: the table is talking

  const idx = TIPS.findIndex((tp) => tp.key === cur);
  const vw = window.innerWidth, vh = window.innerHeight;
  const pad = 8;
  const cardH = 168, cardW = Math.min(320, vw - 24);
  const cardLeft = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 12);

  // The claim/counter panel owns the middle of the screen and runs on a deadline. A coach-mark
  // parked on top of it hides the very thing it is explaining and swallows the taps meant for it,
  // so the card flips to the other side of its target — and if neither side is clear, this tip
  // simply waits until the panel is gone.
  const covers = (top: number) => !!panel
    && top < panel.b && top + cardH > panel.t
    && cardLeft < panel.r && cardLeft + cardW > panel.l;
  const below = rect.bottom + 14 + cardH < vh;
  const preferred = below ? rect.bottom + 14 : Math.max(12, rect.top - cardH - 14);
  const alternate = below ? Math.max(12, rect.top - cardH - 14) : rect.bottom + 14;
  let cardTop = preferred;
  if (covers(cardTop)) {
    if (!covers(alternate) && alternate >= 12 && alternate + cardH <= vh) cardTop = alternate;
    else return null;
  }

  const next = () => setDone((d) => ({ ...d, [cur]: true }));
  const skip = () => { const all: Record<string, boolean> = {}; TIPS.forEach((tp) => (all[tp.key] = true)); setDone(all); };

  return (
    <div className="tour-layer" aria-live="polite">
      <div className="tour-spot" style={{ left: rect.left - pad, top: rect.top - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }} />
      <div className="tour-card" style={{ top: cardTop, left: cardLeft, width: cardW }}>
        <div className="tour-card-head">
          <span className="tour-step">{idx + 1}/{TIPS.length}</span>
          <button type="button" className="tour-skip" onClick={skip}>{t('guide.skip')}</button>
        </div>
        <h3 className="tour-t">{t(`tour.${cur}.t`)}</h3>
        <p className="tour-b">{t(`tour.${cur}.b`)}</p>
        <div className="tour-actions">
          <button type="button" className="tour-next" onClick={next}>{t('tour.next')}<Icon name="alt-arrow-right" className="size-4" /></button>
        </div>
      </div>
    </div>
  );
}
