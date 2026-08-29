import { useState } from 'react';
import { Alert, Button } from '@heroui/react';
import { t } from '../i18n';
import { useStore, store } from '../lib/store';
import { createRoom, joinRoom, playSolo, quickMatch, notify, isConfigured } from '../lib/net';
import { signInWithGoogle, signOutAccount } from '../lib/social';
import { goFullscreen } from '../lib/fullscreen';
import { adBreak, adDue } from '../lib/ads';
import { IMG } from '../theme';
import { GoogleG, Html, Icon, LearnToggle, PlayerAvatar } from './ui';

export function Home() {
  const s = useStore();
  const [code, setCode] = useState(s.autoJoinCode || '');
  const [busy, setBusy] = useState<string | null>(null);
  const [isPublic, setPublic] = useState(false);
  const name = s.name.trim();
  const setName = (v: string) => { store.set({ name: v }); localStorage.setItem('mekina.name', v); };
  const need = () => { if (!name) { notify(t('toast.name')); return false; } return true; };
  const go = async (what: 'create' | 'join' | 'solo' | 'random') => {
    if (!need()) return;
    store.set({ tour: false }); // a normal game is not the guided tour
    if (what === 'join') { const c = code.trim().toUpperCase(); if (c.length !== 4) return notify(t('toast.code')); setBusy(what); await joinRoom(name, c); setBusy(null); return; }
    // Solo jumps straight into the game and nobody else is waiting on it, so the interstitial goes
    // here. Fullscreen must be requested inside the click gesture, so when no ad is coming (the
    // common case) nothing async may come first.
    const showingAd = what === 'solo' && adDue();
    if (what === 'solo' && !showingAd) goFullscreen();
    setBusy(what);
    if (showingAd) { await adBreak('start'); goFullscreen(); } // best effort: the gesture may have expired
    if (what === 'random') { store.set({ searching: true }); await quickMatch(name); store.set({ searching: false }); }
    else if (what === 'create') await createRoom(name, isPublic);
    else await playSolo(name);
    setBusy(null);
  };
  const mePreview = { id: 'me', avatar: s.profile.avatar, avatarData: s.profile.avatarData, color: s.profile.color };
  // Quick match can take a moment to answer; cover the screen so the app never looks frozen.
  if (s.searching) {
    return (
      <section className="screen home-screen">
        <div className="searching big" role="status">
          <span className="sr-radar" aria-hidden="true"><i /><i /><i /></span>
          <b>{t('search.title')}</b>
          <span>{t('search.sub')}</span>
        </div>
      </section>
    );
  }
  return (
    <section className="screen home-screen">
      <div className="home-stage">
        {/* top row: trophies + social pages */}
        <div className="home-top">
          <span className="trophy-pill" title={t('lb.trophies')}><Icon name="win" className="size-4" />{s.trophies}</span>
          <div className="home-top-tools">
            <button type="button" className="acct-tool" onClick={() => store.set({ screen: 'leaderboard' })} aria-label={t('lb.title')}><Icon name="win" className="size-4" /><span className="acct-tool-tx">{t('lb.title')}</span></button>
            <button type="button" className="acct-tool" onClick={() => store.set({ screen: 'public' })} aria-label={t('home.public')}>
              <Icon name="users-room" className="size-4" /><span className="acct-tool-tx">{t('home.public')}</span>
            </button>
            <button type="button" className="acct-tool" onClick={() => store.set({ screen: 'friends' })} aria-label={t('fr.title')}>
              <Icon name="users-group-rounded" className="size-4" /><span className="acct-tool-tx">{t('fr.title')}</span>
              {s.friendReqs.length > 0 && <span className="acct-badge">{s.friendReqs.length}</span>}
            </button>
          </div>
        </div>

        <div className="home-hero">
          <div className="home-emblem"><img src={IMG.machineSmall} alt="" draggable={false} /></div>
          <div className="wordmark">
            <h1>ELMEKINA</h1>
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

        {/* sign-in / identity — sits right under your badge */}
        {s.account && !s.account.isGuest ? (
          <div className="home-signin signed">
            {s.account.avatarUrl ? <img className="acct-photo" src={s.account.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <PlayerAvatar p={mePreview} size="sm" />}
            <span className="acct-name">{s.account.name}</span>
            <button type="button" className="acct-link" onClick={signOutAccount}>{t('acct.signout')}</button>
          </div>
        ) : (
          <button type="button" className="home-signin acct-google" onClick={signInWithGoogle} disabled={!isConfigured}>
            <GoogleG className="size-[18px]" />{t('acct.google')}
          </button>
        )}

        <div className="home-actions">
          {/* Meeting people should not depend on passing a code around, so quick match leads. */}
          <Button fullWidth size="lg" variant="primary" className="home-play" isPending={busy === 'random'} onPress={() => go('random')}>
            <Icon name="users-room" className="size-5" />
            <span className="ha-tx"><span>{t('home.random')}</span><i>{t('home.randomSub')}</i></span>
          </Button>
          <Button fullWidth size="lg" variant="secondary" isPending={busy === 'create'} onPress={() => go('create')}>
            <Icon name="users-group-rounded" className="size-5" />{t('home.create')}
          </Button>
          {/* Who can walk in — decided before the room exists, because it cannot be changed after. */}
          <div className="vis-toggle" role="group" aria-label={t('create.visibility')}>
            {([false, true] as const).map((v) => (
              <button key={String(v)} type="button" className={`vis-opt ${isPublic === v ? 'on' : ''}`} aria-pressed={isPublic === v} onClick={() => setPublic(v)}>
                <Icon name={v ? 'users-room' : 'eye'} className="size-4" />
                <span><b>{t(v ? 'create.public' : 'create.private')}</b><i>{t(v ? 'create.publicSub' : 'create.privateSub')}</i></span>
              </button>
            ))}
          </div>
          <Button fullWidth size="lg" variant="tertiary" isPending={busy === 'solo'} onPress={() => go('solo')}>
            <Icon name="cpu-bolt" className="size-5" />{t('home.solo')}
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
          {/* learning mode: persistent coaching in every game (see lib/store setLearn) */}
          <LearnToggle />
          <button type="button" className="home-howto" onClick={() => store.set({ modal: 'guide' })}>
            <Icon name="question-circle" className="size-4" />{t('coach.rules')}
          </button>
          <p className="hero-foot">{t('home.foot')}</p>
          {/* A reachable privacy policy is a hard requirement for both AdSense and Analytics.
              It is a static page under public/ so crawlers (and the AdSense reviewer) can read it. */}
          <a className="home-privacy" href="/privacy.html" target="_blank" rel="noopener">{t('home.privacy')}</a>
        </div>
      </div>
    </section>
  );
}
