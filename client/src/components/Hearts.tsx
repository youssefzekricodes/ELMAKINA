/**
 * Hearts, where the player sees them.
 *
 *   <HeartPill/>    on the home screen beside the trophies and the flame: the heart and how many
 *                   are left. Drained and pulsing when there are none, because that is the state
 *                   in which the Play button will not do what it says.
 *   <HeartsModal/>  the card behind it — also what every way into a game opens when the hearts
 *                   have run out (lib/hearts.ts haveHeart): the row of hearts, one line on how
 *                   they work, and the rewarded refill.
 *
 * Reads store.hearts, written only by lib/hearts.ts. Null (server not heard from) is drawn as a
 * full set — never as empty, which would be a lie that also looks like a locked game.
 */
import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useStore, store } from '../lib/store';
import { t } from '../i18n';
import { REWARDED_OFFERS } from '../lib/ads';
import { refillHearts } from '../lib/hearts';
import { notify } from '../lib/net';
import { Icon } from './ui';

const HEART = '/img/icons/heart.svg';

export function HeartPill() {
  const h = useStore().hearts;
  // Always on the home screen, even before the server has answered: an unknown count is drawn as
  // a full set, which is also how the gate treats it (lib/hearts.ts lets an unknown through). The
  // level is the hearts themselves — three icons, the spent ones drained — not a digit to decode.
  const left = h ? h.left : 3, max = h ? h.max : 3;
  return (
    <button type="button" className={`heart-pill ${left === 0 ? 'empty' : ''}`}
      onClick={() => store.set({ modal: 'hearts' })} aria-label={t('hearts.count', { n: left, max })} title={t('hearts.title')}>
      {Array.from({ length: max }, (_, i) => (
        <img key={i} src={HEART} alt="" className={`heart-ic ${i < left ? '' : 'spent'}`} draggable={false} />
      ))}
    </button>
  );
}

export function HeartsModal() {
  const s = useStore();
  const open = s.modal === 'hearts';
  const h = s.hearts;
  const [busy, setBusy] = useState(false);
  const left = h?.left ?? 3, max = h?.max ?? 3;
  const refill = async () => {
    setBusy(true);
    const ok = await refillHearts();
    setBusy(false);
    if (ok) { notify(t('hearts.refilled')); store.set({ modal: null }); }
  };
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => store.set({ modal: o ? 'hearts' : null })}>
      <Modal.Container size="sm">
        <Modal.Dialog aria-label={t('hearts.title')} className="hearts-dialog">
          <Modal.CloseTrigger />
          <Modal.Body className="hearts-body">
            <div className="hearts-row" role="img" aria-label={t('hearts.count', { n: left, max })}>
              {Array.from({ length: max }, (_, i) => (
                <img key={i} src={HEART} alt="" draggable={false} className={`hearts-big ${i < left ? '' : 'spent'}`} />
              ))}
            </div>
            <h3 className="hearts-title">{left === 0 ? t('hearts.emptyTitle') : t('hearts.count', { n: left, max })}</h3>
            <p className="hearts-how">{left === 0 ? t('hearts.emptySub') : t('hearts.how')}</p>
            {REWARDED_OFFERS && left < max && (
              <Button fullWidth size="lg" variant="primary" isPending={busy} onPress={refill}>
                <Icon name="play-circle" className="size-5" />{t('hearts.refillBtn')}
              </Button>
            )}
            {left === 0 && <p className="hearts-tomorrow">{t('hearts.tomorrow')}</p>}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
