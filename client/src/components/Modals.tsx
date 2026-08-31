/* Rules (case file) and avatar picker — both HeroUI Modals controlled from the store. */
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Tooltip } from '@heroui/react';
import { CHARACTERS, IMG } from '../theme';
import { i18n, t } from '../i18n';
import { useStore, store, mvAvatar, type Profile } from '../lib/store';
import { commitProfile, notify } from '../lib/net';
import { GameCard, Html, Icon, PlayerAvatar } from './ui';

export function RulesModal() {
  const s = useStore();
  const open = s.modal === 'rules';
  const html = t('rules.html').replace('{cards}', '<div id="rule-cards"></div>');
  const [before, after] = html.split('<div id="rule-cards"></div>');
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => store.set({ modal: o ? 'rules' : null })}>
      <Modal.Container size="lg" scroll="inside">
        <Modal.Dialog aria-label={t('rules.title')}>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading className="modal-title">{t('rules.title')}</Modal.Heading></Modal.Header>
          <Modal.Body className="rules-body">
            <Html as="div" html={before} />
            <div className="rule-chars">
              {CHARACTERS.map((c) => (
                <div key={c} className="rule-char">
                  <GameCard c={c} w={56} small />
                  <div><b className="block">{i18n.charName(c)}</b><span className="text-xs text-muted">{t('char.blurb.' + c)}</span></div>
                </div>
              ))}
            </div>
            <Html as="div" html={after || ''} />
          </Modal.Body>
          <Modal.Footer><Button slot="close" variant="primary">{t('rules.close')}</Button></Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

export function CharactersModal() {
  const s = useStore();
  const open = s.modal === 'chars';
  const cost: Record<string, number> = { terrorist: 3, colonel: 4 };
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => store.set({ modal: o ? 'chars' : null })}>
      <Modal.Container size="md" scroll="inside">
        <Modal.Dialog aria-label={t('chars.title')} className="chars-dialog">
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading className="modal-title">{t('chars.title')}</Modal.Heading></Modal.Header>
          <Modal.Body className="chars-body">
            <p className="chars-sub">{t('chars.sub')}</p>
            <ul className="chars-list">
              {CHARACTERS.map((c) => (
                <li key={c} className="char-row">
                  <span className="char-thumb"><GameCard c={c} w={52} small /></span>
                  <div className="char-info">
                    <div className="char-top">
                      <span className="char-nm">{i18n.charName(c)}</span>
                      {cost[c] ? <span className="char-tag">{cost[c]}<img src={IMG.coin} alt="" /></span> : null}
                    </div>
                    <p className="char-desc">{t('char.blurb.' + c)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Modal.Body>
          <Modal.Footer><Button slot="close" variant="primary">{t('rules.close')}</Button></Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}

/** Opening hand of drawn faces (Multiavatar seeds) — stable so the picker looks the same each visit. */
export const MV_SET = ['sahara', 'sirocco', 'medina', 'harissa', 'jasmine', 'carthage', 'bousaadia', 'sidi bou'];
export const randSeed = () => Math.random().toString(36).slice(2, 9);

/** Name + avatar + colour — the one place you edit who you are, from home OR from inside a room. */
export function AvatarPicker() {
  const s = useStore();
  const open = s.modal === 'avatar';
  const file = useRef<HTMLInputElement>(null);
  const p = s.profile;
  const [mvSeeds, setMvSeeds] = useState<string[]>(MV_SET);
  // Whatever you already wear stays in the tray, even after a shuffle — otherwise picking then
  // shuffling would show you as selected-on-nothing.
  const mySeed = p.avatar.startsWith('mv:') ? p.avatar.slice(3) : null;
  const mvList = mySeed && !mvSeeds.includes(mySeed) ? [mySeed, ...mvSeeds.slice(0, mvSeeds.length - 1)] : mvSeeds;
  /** Deal a fresh hand and wear the first face immediately — the button's effect must be visible. */
  const shuffle = () => {
    const seeds = Array.from({ length: MV_SET.length }, randSeed);
    setMvSeeds(seeds);
    set({ avatar: 'mv:' + seeds[0], avatarData: null });
  };
  const [nm, setNm] = useState(s.name);
  useEffect(() => { if (open) setNm(store.get().name); }, [open]);
  const set = (patch: Partial<Profile>) => commitProfile({ ...p, ...patch });
  /** Push the typed name (locally + to the server when in a room). Returns false when it's blank. */
  const saveName = (quiet = false) => {
    const v = nm.trim().replace(/\s+/g, ' ').slice(0, 16);
    if (!v) { if (!quiet) notify(t('toast.name')); setNm(store.get().name); return false; }
    if (v !== store.get().name) commitProfile(store.get().profile, v);
    setNm(v);
    return true;
  };
  const close = () => { if (saveName()) store.set({ modal: null }); };
  const preview = { id: 'me', avatar: p.avatar, avatarData: p.avatarData, color: p.color };
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files && e.target.files[0]; if (!f) return; e.target.value = '';
    try {
      const url = URL.createObjectURL(f); const img = new Image(); await new Promise((ok, err) => { img.onload = ok; img.onerror = err; img.src = url; });
      const W = 160, H = 176, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const cx = cv.getContext('2d')!;
      const sc = Math.max(W / img.width, H / img.height); const dw = img.width * sc, dh = img.height * sc; cx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh); URL.revokeObjectURL(url);
      let data = cv.toDataURL('image/webp', 0.82); if (!data.startsWith('data:image/webp')) data = cv.toDataURL('image/jpeg', 0.8);
      if (data.length > 110000) data = cv.toDataURL('image/jpeg', 0.6);
      if (data.length > 110000) return notify(t('profile.tooBig'));
      set({ avatar: 'custom', avatarData: data });
    } catch { notify(t('toast.error')); }
  };
  return (
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => { if (!o) saveName(true); store.set({ modal: o ? 'avatar' : null }); }}>
      <Modal.Container size="md" scroll="inside">
        <Modal.Dialog aria-label={t('profile.edit')}>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading className="modal-title">{t('profile.edit')}</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col gap-5">
            <label className="pf-field">
              <span className="pf-label">{t('home.name')}</span>
              <input
                className="pf-name" value={nm} maxLength={16} autoComplete="off" placeholder={t('home.name.ph')} aria-label={t('home.name')}
                onChange={(e) => setNm(e.target.value)}
                onBlur={() => saveName(true)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); saveName(); } }}
              />
            </label>
            {/* Your face, and the one clear way to change it: generate deals a fresh hand of drawn
                faces AND puts the first one on you — the preview changes with every press. */}
            <div className="flex flex-wrap items-center gap-5">
              <PlayerAvatar p={preview} size="xl" />
              <button type="button" className="mv-gen" onClick={shuffle}>
                <Icon name="refresh-circle" className="size-5" />{t('profile.shuffle')}
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <span className="pf-label">{t('profile.mv')}</span>
              <div className="avatar-grid">
                {mvList.map((seed) => (
                  <button key={seed} type="button" onClick={() => set({ avatar: 'mv:' + seed, avatarData: null })} className={`av-opt ${p.avatar === 'mv:' + seed ? 'sel' : ''}`}>
                    <img src={mvAvatar(seed)} alt="" />
                  </button>
                ))}
                <Tooltip delay={300}>
                  <button type="button" onClick={() => file.current?.click()} className={`av-opt upload ${p.avatar === 'custom' ? 'sel' : ''}`} aria-label={t('profile.upload')}>
                    {p.avatar === 'custom' && p.avatarData ? <img src={p.avatarData} alt="" /> : <Icon name="gallery-add" className="size-6 text-accent" />}
                  </button>
                  <Tooltip.Content>{t('profile.upload')}</Tooltip.Content>
                </Tooltip>
                <input ref={file} type="file" accept="image/*" className="hidden" onChange={onFile} />
              </div>
              <span className="mv-credit">Avatars by <a href="https://multiavatar.com" target="_blank" rel="noreferrer">Multiavatar</a></span>
            </div>
          </Modal.Body>
          <Modal.Footer><Button variant="primary" onPress={close}>{t('profile.done')}</Button></Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
