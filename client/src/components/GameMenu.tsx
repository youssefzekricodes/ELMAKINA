import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n';
import { ask } from '../lib/ask';
import { useStore, store } from '../lib/store';
import { leaveRoom, setLanguage, toggleSound } from '../lib/net';
import { Art, Icon } from './ui';

/**
 * In-game controls, everywhere.
 *
 * The header cost a permanent ~50px strip of the scarcest thing a phone has — table height — to
 * show a wordmark and seven controls, none of which are needed mid-turn except the log and the way
 * out. It is gone from every screen now, so this gear is the whole of it on desktop too: the sheet
 * opens from the bottom, where a thumb already is.
 */
export function GameMenu() {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef({ y0: 0, t0: 0, dy: 0, live: false });
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  /**
   * Swipe it away. A drag only starts when the list is already scrolled to the top, so flicking
   * through the items never turns into a dismissal, and only downward movement counts. Let go past
   * a third of the sheet — or throw it 40px+ faster than 0.5px/ms — and it goes; otherwise it
   * springs back. The distance floor matters: without it a stray twitch counted as a flick.
   */
  const onTouchStart = (e: React.TouchEvent) => {
    const el = sheet.current; if (!el || el.scrollTop > 0) return;
    drag.current = { y0: e.touches[0].clientY, t0: Date.now(), dy: 0, live: true };
    el.style.transition = 'none';
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const el = sheet.current; const d = drag.current;
    if (!el || !d.live) return;
    d.dy = Math.max(0, e.touches[0].clientY - d.y0);
    if (d.dy > 0) el.style.transform = `translateY(${d.dy}px)`;
  };
  const onTouchEnd = () => {
    const el = sheet.current; const d = drag.current;
    if (!el || !d.live) return;
    d.live = false;
    const speed = d.dy / Math.max(1, Date.now() - d.t0);
    el.style.transition = 'transform .2s var(--ease)';
    if (d.dy > el.offsetHeight / 3 || (d.dy > 40 && speed > 0.5)) { el.style.transform = `translateY(${el.offsetHeight}px)`; setTimeout(() => setOpen(false), 160); }
    else el.style.transform = '';
  };
  const onLeave = async () => {
    if (s.state && s.state.phase === 'playing' && !(await ask(t('toast.leave'), { ok: t('lobby.leave'), danger: true }))) return;
    await leaveRoom();
  };
  const item = (icon: string, label: string, onPress: () => void, cls = '', tail?: React.ReactNode) => (
    <button type="button" className={`gm-item ${cls}`} role="menuitem" onClick={() => { setOpen(false); onPress(); }}>
      <Icon name={icon} className="size-5" /><span className="gm-tx">{label}</span>{tail}
    </button>
  );
  return (
    <>
      <button type="button" className="gm-btn" aria-label={t('top.more')} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Art name="screw" className="size-5" />
        {s.unread > 0 && <span className="gm-dot">{s.unread > 9 ? '9+' : s.unread}</span>}
      </button>
      {open && (
        <div className="gm-scrim" onClick={() => setOpen(false)}>
          <div className="gm-sheet" ref={sheet} role="menu" aria-label={t('top.more')} onClick={(e) => e.stopPropagation()}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
            <div className="gm-head">
              <span className="gm-brand">ELMEKINA</span>
              {s.room && <span className="gm-code ltr" dir="ltr">{s.room.code}</span>}
            </div>
            {s.net !== 'ok' && (
              <span className={`net-pill ${s.net} gm-net`} role="status">
                <Icon name={s.net === 'off' ? 'danger-triangle' : 'hourglass'} className="size-3.5" />
                <span className="net-tx">{t(s.net === 'off' ? 'net.off' : 'net.slow')}</span>
              </span>
            )}
            {item('document-text', t('top.log'), () => store.set({ logOpen: !s.logOpen, unread: 0 }), '', s.unread > 0 ? <span className="gm-badge">{s.unread > 9 ? '9+' : s.unread}</span> : null)}
            <button type="button" className="gm-item" role="menuitem" onClick={() => { setOpen(false); store.set({ modal: 'chars' }); }}>
              <Art name="cards" className="size-5" /><span className="gm-tx">{t('top.chars')}</span>
            </button>
            {item('question-circle', t('top.rules'), () => store.set({ modal: 'guide' }))}
            <button type="button" className="gm-item" role="menuitem" onClick={() => { setOpen(false); toggleSound(); }}>
              <Art name={s.soundOn ? 'soundOn' : 'soundOff'} className="size-5" /><span className="gm-tx">{t('top.sound')}</span>
            </button>
            <button type="button" className="gm-item" role="menuitem" onClick={() => { setOpen(false); setLanguage(s.lang === 'en' ? 'tn' : 'en'); }}>
              <Art name={s.lang === 'en' ? 'flagTn' : 'flagEn'} className="size-5" /><span className="gm-tx">{t('top.lang.title')}</span>
            </button>
            {item('logout-2', t('top.leave'), onLeave, 'danger')}
          </div>
        </div>
      )}
    </>
  );
}
