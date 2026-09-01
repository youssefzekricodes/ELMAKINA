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
import { setLanguage, toggleMusic, toggleSound } from '../lib/net';
import { t } from '../i18n';
import { Art } from './ui';

/**
 * The buttons themselves, so the home screen can put them in the row it already has instead of
 * having a second set floating over it. `cls` is the caller's own button class — this decides what
 * the buttons DO, never where they sit.
 *
 * Music is its own switch, next to the sound one and a different colour from it: the bed loops for
 * as long as you sit in the menu, while the cues are the game telling you what just happened, and
 * being tired of the first is no reason to lose the second.
 */
export function MenuControls({ cls }: { cls: string }) {
  const s = useStore();
  return (
    <>
      <button type="button" className={cls} onClick={() => setLanguage(s.lang === 'en' ? 'tn' : 'en')}
        aria-label={t('top.lang.title')} title={t('top.lang.title')}>
        <Art name={s.lang === 'en' ? 'flagTn' : 'flagEn'} className="size-6" />
      </button>
      <button type="button" className={`${cls} ${s.soundOn ? '' : 'is-muted'}`} onClick={toggleSound}
        aria-label={t('top.sound')} title={t('top.sound')} aria-pressed={s.soundOn}>
        <Art name={s.soundOn ? 'soundOn' : 'soundOff'} className="size-6" />
      </button>
      <button type="button" className={`${cls} ${s.musicOn ? '' : 'is-muted'}`} onClick={toggleMusic}
        aria-label={t('top.music')} title={t('top.music')} aria-pressed={s.musicOn}>
        <Art name={s.musicOn ? 'musicOn' : 'musicOff'} className="size-6" />
      </button>
    </>
  );
}

export function QuickControls() {
  const s = useStore();
  // Not in a game — the gear carries both. And not on the home screen, which has a row of icons in
  // this exact corner: floating a second pair over it put language and sound on top of the
  // leaderboard and the profile. Home renders them inline instead, in the row that is already there.
  if (s.screen === 'game' || s.screen === 'home') return null;
  return <div className="qc"><MenuControls cls="qc-btn" /></div>;
}
