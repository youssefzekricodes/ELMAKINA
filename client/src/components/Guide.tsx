/* Guided mode: an interactive, step-by-step walkthrough of the rules for first-time players.
   Opened from Home, the first-game Coach, or the topbar "How to play". Controlled via store.modal === 'guide'. */
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { CHARACTERS } from '../theme';
import { i18n, t } from '../i18n';
import { needsMe, useStore, store } from '../lib/store';
import { playSolo } from '../lib/net';
import { goFullscreen } from '../lib/fullscreen';
import { GameCard, Icon, LearnToggle } from './ui';

const STEPS: { key: string; icon: string; chars?: boolean }[] = [
  { key: 'goal', icon: 'win' },
  { key: 'hand', icon: 'card-recive' },
  { key: 'coins', icon: 'wallet-money' },
  { key: 'turn', icon: 'bolt' },
  { key: 'claim', icon: 'hand-stars' },
  { key: 'bluff', icon: 'danger-triangle' },
  { key: 'block', icon: 'shield-warning' },
  { key: 'chars', icon: 'card-recive', chars: true },
  { key: 'win', icon: 'win' },
];

export function Guide() {
  const s = useStore();
  const open = s.modal === 'guide';
  const [i, setI] = useState(0);
  // Reading the rules mid-game is fine right up until the game wants an answer: every window is on
  // a server deadline, so the sheet closes itself rather than letting one run out behind it.
  const myMove = open && needsMe(s);
  useEffect(() => { if (myMove) { setI(0); store.set({ modal: null }); } }, [myMove]);
  if (!open || myMove) return null;
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const close = () => { setI(0); store.set({ modal: null }); };
  const practice = () => { const name = s.name.trim(); setI(0); store.set({ modal: null, tour: true }); goFullscreen(); playSolo(name || 'Player', true); };
  return (
    <div className="guide-backdrop" role="dialog" aria-modal="true" aria-label={t('guide.title')}>
      <div className="guide-card">
        <div className="guide-top">
          <span className="guide-kicker">{t('guide.title')} · {t('guide.step', { n: i + 1, total: STEPS.length })}</span>
          <button type="button" className="guide-skip" onClick={close}>{t('guide.skip')}</button>
        </div>

        <div className="guide-body" key={i}>
          <span className="guide-ic"><Icon name={step.icon} className="size-8" /></span>
          <h2 className="guide-h2">{t(`guide.${step.key}.t`)}</h2>
          <p className="guide-tx">{t(`guide.${step.key}.b`)}</p>
          {step.chars && (
            <div className="guide-chars">
              {CHARACTERS.map((c) => (
                <div key={c} className="guide-char"><GameCard c={c} w={56} small /><span>{i18n.charName(c)}</span></div>
              ))}
            </div>
          )}
        </div>

        <div className="guide-dots" role="tablist" aria-label={t('guide.title')}>
          {STEPS.map((_, k) => (
            <button key={k} type="button" className={`gdot ${k === i ? 'on' : ''} ${k < i ? 'done' : ''}`} aria-label={`${k + 1}`} aria-selected={k === i} onClick={() => setI(k)} />
          ))}
        </div>

        {/* same persistent switch as Home, so it's discoverable from the walkthrough too */}
        <LearnToggle className="guide-learn" />

        <div className="guide-actions">
          {i > 0
            ? <Button variant="tertiary" onPress={() => setI(i - 1)}><Icon name="alt-arrow-left" className="size-4" />{t('guide.back')}</Button>
            : <button type="button" className="guide-rules-link" onClick={() => store.set({ modal: 'rules' })}>{t('guide.rules')}</button>}
          {last
            ? <div className="guide-end">
                <Button variant="tertiary" onPress={close}>{t('guide.close')}</Button>
                <Button variant="primary" onPress={practice}><Icon name="robot" className="size-4" />{t('guide.start')}</Button>
              </div>
            : <Button variant="primary" onPress={() => setI(i + 1)}>{t('guide.next')}<Icon name="alt-arrow-right" className="size-4" /></Button>}
        </div>
      </div>
    </div>
  );
}
