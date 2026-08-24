import { useState } from 'react';
import { Alert, Button } from '@heroui/react';
import { t } from '../i18n';
import { useStore, store } from '../lib/store';
import { createRoom, joinRoom, playSolo, notify, isConfigured } from '../lib/net';
import { goFullscreen } from '../lib/fullscreen';
import { IMG } from '../theme';
import { Html, Icon, PlayerAvatar } from './ui';

export function Home() {
  const s = useStore();
  const [code, setCode] = useState(s.autoJoinCode || '');
  const [busy, setBusy] = useState<string | null>(null);
  const name = s.name.trim();
  const setName = (v: string) => { store.set({ name: v }); localStorage.setItem('mekina.name', v); };
  const need = () => { if (!name) { notify(t('toast.name')); return false; } return true; };
  const go = async (what: 'create' | 'join' | 'solo') => {
    if (!need()) return;
    store.set({ tour: false }); // a normal game is not the guided tour
    if (what === 'join') { const c = code.trim().toUpperCase(); if (c.length !== 4) return notify(t('toast.code')); setBusy(what); await joinRoom(name, c); setBusy(null); return; }
    if (what === 'solo') goFullscreen(); // solo jumps straight into the game — grab fullscreen within this click gesture
    setBusy(what);
    if (what === 'create') await createRoom(name); else await playSolo(name);
    setBusy(null);
  };
  const mePreview = { id: 'me', avatar: s.profile.avatar, avatarData: s.profile.avatarData, color: s.profile.color };
  return (
    <section className="screen home-screen">
      <div className="home-stage">
        <div className="home-hero">
          <div className="home-emblem"><img src={IMG.machineSmall} alt="" draggable={false} /></div>
          <div className="wordmark">
            <h1>ELMAKINA</h1>
            <Html as="p" className="tagline" html={t('home.tagline')} />
          </div>
        </div>

        {!isConfigured && (
          <Alert status="warning" className="w-full text-start">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Supabase is not configured</Alert.Title>
              <Alert.Description>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in the repo <code>.env</code>, then rebuild.</Alert.Description>
            </Alert.Content>
          </Alert>
        )}

        {/* player badge — you assume an identity before you sit down */}
        <div className="home-badge">
          <button type="button" className="badge-photo" onClick={() => store.set({ modal: 'avatar' })} aria-label={t('profile.change')} title={t('profile.change')}>
            <PlayerAvatar p={mePreview} size="lg" />
            <span className="badge-photo-edit"><Icon name="gallery-add" className="size-3.5" /></span>
          </button>
          <div className="badge-fields">
            <span className="badge-label">{t('home.name')}</span>
            <input
              className="home-name" value={s.name} onChange={(e) => setName(e.target.value)}
              placeholder={t('home.name.ph')} maxLength={16} autoComplete="off" aria-label={t('home.name')}
              autoFocus={!!s.autoJoinCode}
              onKeyDown={(e) => { if (e.key === 'Enter') go(code ? 'join' : 'create'); }}
            />
          </div>
        </div>

        <div className="home-actions">
          <Button fullWidth size="lg" variant="primary" className="home-play" isPending={busy === 'create'} onPress={() => go('create')}>
            <Icon name="users-room" className="size-5" />{t('home.create')}
          </Button>
          <Button fullWidth size="lg" variant="secondary" isPending={busy === 'solo'} onPress={() => go('solo')}>
            <Icon name="robot" className="size-5" />{t('home.solo')}
          </Button>
        </div>

        <div className="home-or"><span>{t('home.or')}</span></div>

        <div className="home-join">
          <input
            className="home-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t('home.code.ph')} maxLength={4} autoCapitalize="characters" autoComplete="off"
            aria-label={t('home.code.ph')} dir="ltr"
            onKeyDown={(e) => { if (e.key === 'Enter') go('join'); }}
          />
          <Button size="lg" variant="primary" className="home-join-go" isPending={busy === 'join'} onPress={() => go('join')}>
            <Icon name="login-2" className="size-4" />{t('home.join')}
          </Button>
        </div>

        <div className="home-foot-row">
          <button type="button" className="home-howto" onClick={() => store.set({ modal: 'guide' })}>
            <Icon name="question-circle" className="size-4" />{t('coach.rules')}
          </button>
          <p className="hero-foot">{t('home.foot')}</p>
        </div>
      </div>
    </section>
  );
}
