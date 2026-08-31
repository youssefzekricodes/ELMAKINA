/**
 * The update gate.
 *
 * Blocking, because a stale client talking to a moved-on server is exactly the failure this is
 * meant to prevent — but never in the middle of a hand. Yanking the page out from under someone
 * mid-turn loses them the game, so while a match is actually being played it waits as a quiet
 * strip and takes over the moment the hand is over.
 */
import { useState } from 'react';
import { Button } from '@heroui/react';
import { useStore } from '../lib/store';
import { applyUpdate } from '../lib/update';
import { t } from '../i18n';
import { Art, Icon } from './ui';

export function UpdateGate() {
  const s = useStore();
  const [busy, setBusy] = useState(false);
  if (!s.updateReady) return null;
  const midHand = s.screen === 'game' && !!s.state && s.state.phase === 'playing';
  const go = () => { setBusy(true); applyUpdate(); };

  if (midHand) {
    return (
      <button type="button" className="upd-strip" onClick={go} disabled={busy}>
        <Icon name="refresh-circle" className="size-4" />{t('upd.now')}
      </button>
    );
  }
  return (
    <div className="upd-gate" role="dialog" aria-modal="true" aria-label={t('upd.title')}>
      <div className="upd-card">
        <Art name="screw" className="upd-art" />
        <h2 className="upd-title">{t('upd.title')}</h2>
        <p className="upd-sub">{t('upd.sub')}</p>
        <Button fullWidth size="lg" variant="primary" isPending={busy} onPress={go}>{t('upd.btn')}</Button>
      </div>
    </div>
  );
}
