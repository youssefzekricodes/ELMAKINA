/* Rules (case file) and avatar picker — both HeroUI Modals controlled from the store. */
import { useRef } from 'react';
import { Button, Modal, Tooltip } from '@heroui/react';
import { CHARACTERS, DEFAULT_AVATARS, IMG, PALETTE } from '../theme';
import { i18n, t } from '../i18n';
import { useStore, store, type Profile } from '../lib/store';
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

export function AvatarPicker() {
  const s = useStore();
  const open = s.modal === 'avatar';
  const file = useRef<HTMLInputElement>(null);
  const p = s.profile;
  const set = (patch: Partial<Profile>) => commitProfile({ ...p, ...patch });
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
    <Modal.Backdrop isOpen={open} onOpenChange={(o) => store.set({ modal: o ? 'avatar' : null })}>
      <Modal.Container size="md" scroll="inside">
        <Modal.Dialog aria-label={t('profile.pick')}>
          <Modal.CloseTrigger />
          <Modal.Header><Modal.Heading className="modal-title">{t('profile.pick')}</Modal.Heading></Modal.Header>
          <Modal.Body className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-5">
              <PlayerAvatar p={preview} size="xl" />
              <div className="flex flex-col gap-2">
                <span className="text-xs font-medium text-muted">{t('profile.color')}</span>
                <div className="flex flex-wrap gap-2">
                  <Tooltip delay={300}>
                    <button type="button" aria-label={t('profile.auto')} onClick={() => set({ color: null })} className={`color-chip auto ${!p.color ? 'sel' : ''}`}>A</button>
                    <Tooltip.Content>{t('profile.auto')}</Tooltip.Content>
                  </Tooltip>
                  {PALETTE.map((c) => (
                    <Tooltip key={c.color} delay={300}>
                      <button type="button" aria-label={i18n.charName(c.name)} onClick={() => set({ color: c.color })} className={`color-chip ${p.color === c.color ? 'sel' : ''}`} style={{ '--c': c.color } as any} />
                      <Tooltip.Content>{i18n.charName(c.name)}</Tooltip.Content>
                    </Tooltip>
                  ))}
                </div>
              </div>
            </div>
            <div className="avatar-grid">
              {DEFAULT_AVATARS.map((a) => (
                <button key={a} type="button" onClick={() => set({ avatar: a, avatarData: null })} className={`av-opt ${p.avatar === a ? 'sel' : ''}`} style={{ '--bg': p.color || '#727274' } as any}>
                  <img src={`/img/avatars/${a}.webp`} alt={a} />
                </button>
              ))}
              <button type="button" onClick={() => file.current?.click()} className={`av-opt upload ${p.avatar === 'custom' ? 'sel' : ''}`} style={{ '--bg': p.color || '#727274' } as any}>
                {p.avatar === 'custom' && p.avatarData ? <img src={p.avatarData} alt="" /> : <Icon name="gallery-add" className="size-7 text-accent" />}
                <span className="text-[11px] font-medium">{t('profile.upload')}</span>
              </button>
              <input ref={file} type="file" accept="image/*" className="hidden" onChange={onFile} />
            </div>
          </Modal.Body>
          <Modal.Footer><Button slot="close" variant="primary">{t('profile.done')}</Button></Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
