/**
 * Game settings — the sheet behind the front door's fourth tile.
 *
 * The set-once controls (characters, rules, sound, language) used to sit as loose icon buttons
 * above the hero, where they competed with the three ways to start a game. They are one tile now,
 * and this is what is behind it.
 */
import { store, useStore } from '../lib/store';
import { setLanguage, toggleSound } from '../lib/net';
import { t } from '../i18n';
import { Art, Icon } from './ui';

export function SettingsSheet() {
  const s = useStore();
  if (s.modal !== 'settings') return null;
  const close = () => store.set({ modal: null });
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={t('set.title')} onClick={close}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="sheet-title"><Art name="screw" className="size-6" />{t('set.title')}</h2>
          <button type="button" className="sheet-x" onClick={close} aria-label={t('preview.cancel')}><Icon name="close-circle" className="size-5" /></button>
        </div>
        <div className="sheet-body pf-rows">
          <button type="button" className="pf-row" onClick={() => store.set({ modal: 'chars' })}>
            <Art name="cards" className="size-6" /><span>{t('top.chars')}</span><Icon name="alt-arrow-right" className="size-4 pf-chev" />
          </button>
          <button type="button" className="pf-row" onClick={() => store.set({ modal: 'guide' })}>
            <Icon name="question-circle" className="size-6" /><span>{t('top.rules')}</span><Icon name="alt-arrow-right" className="size-4 pf-chev" />
          </button>
          <button type="button" className="pf-row" onClick={toggleSound}>
            <Art name={s.soundOn ? 'soundOn' : 'soundOff'} className="size-6" /><span>{t('top.sound')}</span>
            <span className="pf-val">{t(s.soundOn ? 'profile.on' : 'profile.off')}</span>
          </button>
          <button type="button" className="pf-row" onClick={() => setLanguage(s.lang === 'en' ? 'tn' : 'en')}>
            <Art name={s.lang === 'en' ? 'flagTn' : 'flagEn'} className="size-6 pf-flag" /><span>{t('top.lang.title')}</span>
            <Icon name="alt-arrow-right" className="size-4 pf-chev" />
          </button>
        </div>
      </div>
    </div>
  );
}
