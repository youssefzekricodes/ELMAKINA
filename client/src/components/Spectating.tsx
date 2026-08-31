/* You are out.
 *
 * The board carries on exactly as before once your last card is gone — same table, same log, same
 * cards along the bottom — and the only word for it was one line in the console that a plain
 * "waiting for X" outranked most of the time. Being out is a state, not a notification: this says
 * so and keeps saying so until the game ends. */
import { useStore } from '../lib/store';
import { t } from '../i18n';
import { Icon } from './ui';

export function Spectating() {
  const s = useStore();
  const st = s.state;
  if (!st || st.phase !== 'playing') return null;   // the end screen speaks for itself
  const me = st.players.find((p) => p.id === s.me);
  if (!me || me.alive) return null;
  return (
    <div className="spectating" role="status">
      <Icon name="eliminated" className="size-5" />
      <span className="sp-tx"><b>{t('spec.title')}</b><i>{t('spec.sub')}</i></span>
    </div>
  );
}
