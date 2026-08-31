/**
 * Language and sound, with nothing around them.
 *
 * The header that used to hold them is gone from every screen — it spent a permanent strip on a
 * wordmark and a row of controls that are set once and then never touched again. These two are the
 * part worth keeping in reach, so they stand on their own in the corner: two icons, no bar, no
 * background, nothing that has to be a header to hold them.
 *
 * In a game they are already in the gear's sheet, and the board needs its corners — so nothing is
 * drawn here at all.
 */
import { useStore } from '../lib/store';
import { setLanguage, toggleSound } from '../lib/net';
import { t } from '../i18n';
import { Art } from './ui';

export function QuickControls() {
  const s = useStore();
  if (s.screen === 'game') return null;
  return (
    <div className="qc">
      <button type="button" className="qc-btn" onClick={() => setLanguage(s.lang === 'en' ? 'tn' : 'en')}
        aria-label={t('top.lang.title')} title={t('top.lang.title')}>
        <Art name={s.lang === 'en' ? 'flagTn' : 'flagEn'} className="size-6" />
      </button>
      <button type="button" className="qc-btn" onClick={toggleSound}
        aria-label={t('top.sound')} title={t('top.sound')} aria-pressed={s.soundOn}>
        <Art name={s.soundOn ? 'soundOn' : 'soundOff'} className="size-6" />
      </button>
    </div>
  );
}
