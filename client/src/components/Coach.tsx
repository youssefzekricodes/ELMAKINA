/* First-game onboarding: a one-time "briefing" card. Dismissal is remembered in localStorage.
   It shows in the lobby where nothing is running, and in a game only while the table is idle —
   the moment a claim lands or the turn is mine it steps aside, because every window in this game
   is on a server deadline and a briefing that outlasts one costs a real card. */
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { t } from '../i18n';
import { isCoaching, needsMe, store, tableBusy, useStore } from '../lib/store';
import { Art, Icon } from './ui';

const KEY = 'mekina.coachSeen';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };

export function Coach() {
  const s = useStore();
  const [open, setOpen] = useState(!seen());
  const inGame = s.screen === 'game' && !!s.state;
  // Reading the briefing must never be why you missed the first claim or your own turn.
  const yield_ = inGame && (needsMe(s) || tableBusy(s));
  // Stepping aside is not the same as being read: it stays UNSEEN in storage so the next lobby
  // offers it again, but it will not pop back in the middle of this game once play has begun.
  const [interrupted, setInterrupted] = useState(false);
  useEffect(() => { if (open && yield_) setInterrupted(true); }, [open, yield_]);
  if (!open || yield_ || interrupted || s.tour) return null; // the guide's practice tour is its own tutorial — don't double up
  if (s.screen !== 'lobby' && !inGame) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } setOpen(false); };
  const tips: [string, string][] = [
    ['users-room', t('coach.hand')],
    ['bolt', t('coach.actions')],
    ['danger-triangle', t('coach.bluff')],
    ['document-text', t('coach.log')],
  ];
  return (
    <div className="coach-backdrop" role="dialog" aria-modal="true" aria-label={t('coach.title')} onClick={dismiss}>
      <div className="coach-card" onClick={(e) => e.stopPropagation()}>
        <div className="coach-head">
          <span className="coach-kicker">{t('coach.title')}</span>
          <h2 className="coach-h2">{t('coach.sub')}</h2>
        </div>
        <ul className="coach-tips">
          {tips.map(([icon, text], i) => (
            <li key={i}><span className="coach-ic"><Icon name={icon} className="size-4" /></span><span>{text}</span></li>
          ))}
        </ul>
        {/* learning mode: the character reference is one tap away before you play a single card */}
        {isCoaching(s) && (
          <button type="button" className="coach-chars" onClick={() => { dismiss(); store.set({ modal: 'chars' }); }}>
            <Art name="cards" className="size-5" />{t('chars.title')}
          </button>
        )}
        <div className="coach-actions">
          <Button variant="tertiary" onPress={() => { dismiss(); store.set({ modal: 'guide' }); }}>{t('coach.rules')}</Button>
          <Button variant="primary" onPress={dismiss}><Icon name="check-circle" className="size-4" />{t('coach.got')}</Button>
        </div>
      </div>
    </div>
  );
}
