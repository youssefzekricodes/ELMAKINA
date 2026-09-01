/**
 * The one time we ask about notifications.
 *
 * Asking at the end of onboarding covers new players and nobody else — anyone who already had an
 * account never saw that screen and was therefore never asked at all, which is not the same thing
 * as having said no. This is a card on the front door for exactly those people: shown once, taken
 * down for good either way, and never shown to somebody who has already answered or to a browser
 * that cannot do this.
 *
 * It has to be a tap: a permission prompt raised outside a gesture is refused, and a refusal counts
 * as a "no" the player never said.
 */
import { useState } from 'react';
import { Button } from '@heroui/react';
import { t } from '../i18n';
import { useStore } from '../lib/store';
import { enablePush, markPushAsked, pushAsked, pushStatus } from '../lib/push';
import { Icon } from './ui';

export function PushPrompt() {
  const s = useStore();
  const [gone, setGone] = useState(() => pushAsked());
  const [busy, setBusy] = useState(false);
  // Only where there is something to ask FOR: push works, the browser has not decided yet, and the
  // player is far enough in to have a name.
  if (gone || busy || pushStatus() !== 'default' || !s.name.trim()) return null;

  const yes = async () => { setBusy(true); await enablePush(); setGone(true); setBusy(false); };
  const no = () => { markPushAsked(); setGone(true); };

  return (
    <div className="push-ask" role="region" aria-label={t('push.title')}>
      <span className="push-ask-ic"><Icon name="bell" className="size-5" /></span>
      <div className="push-ask-tx">
        <b>{t('push.ask.title')}</b>
        <span>{t('push.ask.sub')}</span>
      </div>
      <div className="push-ask-btns">
        <Button size="sm" variant="primary" onPress={yes}>{t('push.ask.yes')}</Button>
        <Button size="sm" variant="tertiary" onPress={no}>{t('push.ask.no')}</Button>
      </div>
    </div>
  );
}
