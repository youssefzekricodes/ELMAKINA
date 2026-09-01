/* The front gate: a full-screen first-run step — pick a face, type a name. There is no close
   button and no way around it, because a table can't seat a player with no name. */
import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { enablePush } from '../lib/push';
import { t } from '../i18n';
import { useStore, store, mvAvatar } from '../lib/store';
import { commitProfile, notify } from '../lib/net';
import { Icon, PlayerAvatar } from './ui';
import { MV_SET, randSeed } from './Modals';

export function Onboarding() {
  const s = useStore();
  const [nm, setNm] = useState('');
  const [seeds, setSeeds] = useState<string[]>(MV_SET);
  const p = s.profile;
  // A face is already on before the screen is even read: generated once, worn immediately.
  useEffect(() => {
    const cur = store.get().profile;
    if (!cur.avatar.startsWith('mv:') && cur.avatar !== 'custom') commitProfile({ ...cur, avatar: 'mv:' + randSeed(), avatarData: null });
  }, []);
  const wear = (seed: string) => commitProfile({ ...store.get().profile, avatar: 'mv:' + seed, avatarData: null });
  const shuffle = () => {
    const next = Array.from({ length: MV_SET.length }, randSeed);
    setSeeds(next);
    wear(next[0]);
  };
  const mySeed = p.avatar.startsWith('mv:') ? p.avatar.slice(3) : null;
  const list = mySeed && !seeds.includes(mySeed) ? [mySeed, ...seeds.slice(0, seeds.length - 1)] : seeds;
  const start = () => {
    const v = nm.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (!v) return notify(t('toast.name'));
    commitProfile(store.get().profile, v);
    localStorage.setItem('mekina.name', v);
    store.set({ onboarding: false });
    // The one honest moment to ask: they have just typed a name and pressed Start, so the prompt is
    // the answer to something they did rather than an interruption of it. Inside the click, because
    // browsers will not show a permission prompt outside a gesture.
    enablePush();
  };
  return (
    <div className="ob-screen" role="dialog" aria-modal="true" aria-label={t('ob.title')}>
      <div className="ob-card">
        <h2 className="ob-title">{t('ob.title')}</h2>
        <p className="ob-sub">{t('ob.sub')}</p>
        <div className="ob-face">
          <PlayerAvatar p={{ id: 'me', avatar: p.avatar, avatarData: p.avatarData, color: p.color }} size="xl" />
          <button type="button" className="mv-gen" onClick={shuffle}>
            <Icon name="refresh-circle" className="size-5" />{t('profile.shuffle')}
          </button>
        </div>
        <div className="avatar-grid ob-grid">
          {list.map((seed) => (
            <button key={seed} type="button" onClick={() => wear(seed)} className={`av-opt ${p.avatar === 'mv:' + seed ? 'sel' : ''}`}>
              <img src={mvAvatar(seed)} alt="" />
            </button>
          ))}
        </div>
        <label className="pf-field ob-name">
          <span className="pf-label">{t('home.name')}</span>
          <input
            className="pf-name" value={nm} maxLength={16} autoComplete="off" autoFocus placeholder={t('home.name.ph')} aria-label={t('home.name')}
            onChange={(e) => setNm(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); start(); } }}
          />
        </label>
        <Button variant="primary" className="ob-start" isDisabled={!nm.trim()} onPress={start}>{t('ob.start')}</Button>
        <span className="mv-credit">Avatars by <a href="https://multiavatar.com" target="_blank" rel="noreferrer">Multiavatar</a></span>
      </div>
    </div>
  );
}
