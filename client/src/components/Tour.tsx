/* Guided-play tour: coach-marks that spotlight your cards and the action buttons during a real
   solo game. Active while store.tour is set. The dark backdrop is click-through (pointer-events:none)
   so gameplay is never blocked — only the coach card itself is interactive. */
import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { useStore } from '../lib/store';
import { Icon } from './ui';

// Shown in order; each tip appears the first time its target exists and hasn't been dismissed.
const TIPS = [
  { key: 'hand', sel: '.console .hand' },        // MY hand in the console (not an opponent's)
  { key: 'coins', sel: '.me-coins' },
  { key: 'basic', sel: '.basic-row' },
  { key: 'claims', sel: '.act-grid.claims' },
  { key: 'react', sel: '.cl-btns' },             // only exists when I can actually react (pass/block/call)
  { key: 'result', sel: '.verdict-strip' },      // shown when a called bluff resolves
];

export function Tour() {
  const s = useStore();
  const meP = s.state?.players?.find((p) => p.id === s.me);
  const active = !!(s.tour && s.screen === 'game' && meP && meP.alive); // stop coaching once eliminated / spectating
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [cur, setCur] = useState<string | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!active) return;
    const compute = () => {
      const tip = TIPS.find((tp) => !done[tp.key] && document.querySelector(tp.sel));
      if (!tip) { setCur(null); setRect(null); return; }
      const el = document.querySelector(tip.sel) as HTMLElement | null;
      setCur(tip.key);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    compute();
    const id = window.setInterval(compute, 250);
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => { window.clearInterval(id); window.removeEventListener('resize', compute); window.removeEventListener('scroll', compute, true); };
  }, [active, done]);

  if (!active || !cur || !rect) return null;

  const idx = TIPS.findIndex((tp) => tp.key === cur);
  const vw = window.innerWidth, vh = window.innerHeight;
  const pad = 8;
  const cardH = 168, cardW = Math.min(320, vw - 24);
  const below = rect.bottom + 14 + cardH < vh;
  const cardTop = below ? rect.bottom + 14 : Math.max(12, rect.top - cardH - 14);
  const cardLeft = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 12);

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
