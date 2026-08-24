/* First-game onboarding: a one-time "briefing" card. Dismissal is remembered in localStorage. */
import { useState } from 'react';
import { Button } from '@heroui/react';
import { t } from '../i18n';
import { store, useStore } from '../lib/store';
import { Icon } from './ui';

const KEY = 'mekina.coachSeen';
const seen = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return true; } };

export function Coach() {
  const tour = useStore().tour;
  const [open, setOpen] = useState(!seen());
  if (!open || tour) return null; // the guided tour is its own tutorial — don't double up
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
        <div className="coach-actions">
          <Button variant="tertiary" onPress={() => { dismiss(); store.set({ modal: 'guide' }); }}>{t('coach.rules')}</Button>
          <Button variant="primary" onPress={dismiss}><Icon name="check-circle" className="size-4" />{t('coach.got')}</Button>
        </div>
      </div>
    </div>
  );
}
