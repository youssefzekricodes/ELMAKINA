/**
 * The streak, everywhere it shows its face.
 *
 *   <StreakPill/>   the flame + count on the home screen; grey until today's game is played,
 *                   pulsing blue when the streak is one rewarded ad from being lost.
 *   <StreakModal/>  the card behind the pill: the uploaded scene art (warm when alive, the blue
 *                   variant when frozen/at risk), count, best, the save-with-an-ad offer, and —
 *                   on Android — the "pin it to your home screen" button.
 *   <StreakCine/>   the full-screen beat when the streak grows: the Lottie flame, the number
 *                   punching in, and the phone buzzing under it. Lottie is lazy-loaded — the
 *                   player is ~60KB gzipped and most sessions never extend a streak.
 *
 * Everything reads store.streak / store.streakCine, written only by lib/streaks.ts.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useStore, store } from '../lib/store';
import { t } from '../i18n';
import { rewardedAd } from '../lib/ads';
import { saveStreak } from '../lib/streaks';
import { canPinWidget, isWidgetPinned, promptPinWidget } from '../lib/widget';
import { notify } from '../lib/net';
import { Icon } from './ui';

const FIRE = '/img/streaks/fire.svg';

export function StreakPill() {
  const s = useStore();
  const st = s.streak;
  // Shown from zero, not from one.
  //
  // Hiding it until a streak exists meant the feature was invisible to exactly the people it is for:
  // a new player never saw a flame, so nothing ever suggested that finishing a game today was worth
  // anything. A grey 0 is an invitation; nothing is nothing. Only a missing streak object — the
  // server has not answered yet, or the player is not signed in — renders nothing at all.
  if (!st) return null;
  const state = st.atRisk ? 'risk' : st.count === 0 ? 'none' : st.today ? 'lit' : 'cold';
  return (
    <button type="button" className={`streak-pill ${state}`}
      onClick={() => store.set({ modal: 'streak' })}
      aria-label={st.count === 0 ? t('widget.start') : t('streak.title')}
      title={st.count === 0 ? t('widget.start') : t('streak.title')}>
      <img src={FIRE} alt="" className="streak-fire" draggable={false} />
      <b className="streak-n">{st.atRisk ? '!' : st.count}</b>
    </button>
  );
}

export function StreakModal() {
  const s = useStore();
  const open = s.modal === 'streak';
  const st = s.streak;
  const [pinnable, setPinnable] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  // Asked every time the card opens, not once: the player can add or remove the widget from the
  // launcher while the app sits in the background, and a stale answer offers a button for something
  // already done.
  useEffect(() => {
    if (!open) return;
    canPinWidget().then(setPinnable);
    isWidgetPinned().then(setPinned);
  }, [open]);

  const save = async () => {
    setBusy(true);
    const r = await rewardedAd();
    // The reward is granted on 'earned' and nothing else — see lib/ads. 'unavailable' must not
    // punish the player for our ad problem, so it saves too; only walking out of the video does not.
    const ok = r !== 'dismissed' && (await saveStreak());
    setBusy(false);
    if (ok) notify(t('streak.savedToast'));
  };

  const frozen = !!st && st.freezes > 0;
  const blue = !!st && (st.atRisk || frozen);
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => store.set({ modal: o ? 'streak' : null })}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={t('streak.title')} className="streak-dialog">
          <Modal.CloseTrigger />
          {/* The art sits INSIDE the padded frame rather than bleeding to the dialog's edge, so the
              close control keeps its corner instead of landing on the picture. */}
          <div className={`streak-hero ${blue ? 'freeze' : ''}`}>
            <img className="streak-hero-art" src={blue ? '/img/streaks/banner-freeze.webp' : '/img/streaks/banner-warm.webp'} alt="" />
            <div className="streak-hero-body">
              {blue
                ? <img src="/img/streaks/Streak-freeze.webp" alt="" className="streak-big-ic" draggable={false} />
                : <img src={FIRE} alt="" className="streak-big-ic" draggable={false} />}
              <div className="streak-count">{st?.count ?? 0}</div>
              <div className="streak-sub">{t(st?.atRisk ? 'streak.riskSub' : frozen ? 'streak.frozenSub' : 'streak.sub')}</div>
            </div>
          </div>
          <Modal.Body className="streak-body">
            <div className="streak-stats">
              <span className="streak-stat">
                <img src={FIRE} alt="" className="streak-stat-ic" draggable={false} />
                <b>{st?.best ?? 0}</b> {t('streak.best')}
              </span>
              <span className={`streak-stat ${frozen ? 'has-freeze' : ''}`}>
                <img src="/img/streaks/Streak-freeze.webp" alt="" className="streak-stat-ic" draggable={false} />
                <b>{st?.freezes ?? 0}</b> {t('streak.freezes')}
              </span>
            </div>
            {st?.atRisk && (
              <Button fullWidth size="lg" variant="primary" isPending={busy} onPress={save} className="streak-save">
                <Icon name="videocamera" className="size-5" />{t('streak.saveBtn')}
              </Button>
            )}
            {!st?.atRisk && <p className="streak-how">{t('streak.how')}</p>}
            {pinned
              ? <p className="streak-pinned"><Icon name="check-circle" className="size-4" />{t('streak.pinned')}</p>
              : pinnable && (
                <Button fullWidth size="md" variant="outline" onPress={() => promptPinWidget()}>
                  <Icon name="pin" className="size-4" />{t('streak.pinBtn')}
                </Button>
              )}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function StreakCine() {
  const s = useStore();
  const cine = s.streakCine;
  const box = useRef<HTMLDivElement | null>(null);
  const [closing, setClosing] = useState(false);
  const close = () => { setClosing(true); setTimeout(() => { setClosing(false); store.set({ streakCine: null }); }, 260); };

  useEffect(() => {
    if (!cine || !box.current) return;
    let anim: { destroy(): void } | null = null;
    let dead = false;
    // The buzz lands with the flame: short-long-short, the shape of "something good".
    try { navigator.vibrate?.([60, 40, 120]); } catch { /* iOS WebView has no vibrate */ }
    import('lottie-web/build/player/lottie_light').then((m) => {
      if (dead || !box.current) return;
      anim = m.default.loadAnimation({ container: box.current, renderer: 'svg', loop: true, autoplay: true, path: '/img/streaks/fire-streak.json' });
    }).catch(() => { /* the still flame underneath carries the moment */ });
    const timer = setTimeout(close, 6500);   // a screen, not a toast: long enough to read, never a trap
    return () => { dead = true; clearTimeout(timer); anim?.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cine]);

  if (!cine) return null;
  return (
    <div className={`streak-cine ${closing ? 'out' : ''}`} role="dialog" aria-label={t('streak.gained', { n: cine.count })} onClick={close}>
      <div className="sc-flame" ref={box}><img src={FIRE} alt="" className="sc-flame-fallback" /></div>
      <div className="sc-count">{cine.count}</div>
      <div className="sc-title">{t(cine.count === 1 ? 'streak.first' : 'streak.gainedT')}</div>
      <div className="sc-sub">{t(cine.froze ? 'streak.frozeSub' : 'streak.keep')}</div>
      <button type="button" className="sc-continue" onClick={(e) => { e.stopPropagation(); close(); }}>{t('streak.continue')}</button>
    </div>
  );
}
