import { useState } from 'react';
import { Alert, Button } from '@heroui/react';
import { t } from '../i18n';
import { useStore, store } from '../lib/store';
import { createRoom, joinRoom, playSolo, quickMatch, notify, isConfigured } from '../lib/net';
import { signInWithGoogle, signOutAccount } from '../lib/social';
import { goFullscreen } from '../lib/fullscreen';
import { adBreak, adDue } from '../lib/ads';
import { IMG } from '../theme';
import { GoogleG, Html, Icon, PlayerAvatar } from './ui';

/**
 * The front door. One thing to press.
 *
 * It used to offer five ways to start a game, all at the same weight, plus a visibility toggle for
 * a room that did not exist yet, plus a sign-in button as loud as Play. Everything that is not
 * "start playing" is now quiet: three plain options on one line, the code field only when asked
 * for, and the account and legal links reduced to footnotes. Room visibility moved into the lobby,
 * where you are actually looking at the room and can change your mind.
 */
export function Home() {
  const s = useStore();
  const [code, setCode] = useState(s.autoJoinCode || '');
  const [joining, setJoining] = useState(!!s.autoJoinCode);
  const [busy, setBusy] = useState<string | null>(null);
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
    else if (what === 'create') await createRoom(name);
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
        {/* Status and side rooms. Icon-only: none of it is why anyone opened the app. */}
        <div className="home-top">
          <span className="trophy-pill" title={t('lb.trophies')}><Icon name="win" className="size-4" />{s.trophies}</span>
          <div className="home-top-tools">
            <button type="button" className="acct-tool" onClick={() => store.set({ screen: 'leaderboard' })} aria-label={t('lb.title')} title={t('lb.title')}><Icon name="win" className="size-4" /></button>
            <button type="button" className="acct-tool" onClick={() => store.set({ screen: 'public' })} aria-label={t('home.public')} title={t('home.public')}><Icon name="users-room" className="size-4" /></button>
            <button type="button" className="acct-tool" onClick={() => store.set({ screen: 'friends' })} aria-label={t('fr.title')} title={t('fr.title')}>
              <Icon name="users-group-rounded" className="size-4" />
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

        {/* Who you are at the table: one line, the placeholder does the labelling. */}
        <div className="home-badge">
          <button type="button" className="badge-photo" onClick={() => store.set({ modal: 'avatar' })} aria-label={t('profile.change')} title={t('profile.change')}>
            <PlayerAvatar p={mePreview} size="md" />
            <span className="badge-photo-edit"><Icon name="pen" className="size-3" /></span>
          </button>
          {/* An unmistakable field: a small standing label, because once a name is typed the
              placeholder is gone and a quiet box full of text reads as decoration, not an input. */}
          <label className="home-name-wrap">
            <span className="home-name-lbl">{t('home.name')}</span>
            <input
              className="home-name" value={s.name} onChange={(e) => setName(e.target.value)}
              placeholder={t('home.name.ph')} maxLength={16} autoComplete="off"
              autoFocus={!!s.autoJoinCode}
              onKeyDown={(e) => { if (e.key === 'Enter') go(joining ? 'join' : 'random'); }}
            />
          </label>
        </div>

        {/* The one thing to press. */}
        <Button fullWidth size="lg" variant="primary" className="home-play" isPending={busy === 'random'} onPress={() => go('random')}>
          <span className="hp-tx"><b>{t('home.playNow')}</b><i>{t('home.randomSub')}</i></span>
        </Button>

        {/* Everything else, on one line and deliberately plain. */}
        <div className="home-more">
          <button type="button" className="hm-opt" onClick={() => go('create')} disabled={busy === 'create'}>
            <Icon name="users-group-rounded" className="size-4" />{t('home.create')}
          </button>
          {/* Short label: three tiles on one line have room for a word, not a sentence. The full
              "against the machine" wording still lives in the guide. */}
          <button type="button" className="hm-opt" onClick={() => go('solo')} disabled={busy === 'solo'} title={t('home.solo')}>
            <Icon name="cpu-bolt" className="size-4" />{t('home.soloShort')}
          </button>
          <button type="button" className={`hm-opt ${joining ? 'on' : ''}`} aria-expanded={joining} onClick={() => setJoining((v) => !v)}>
            <Icon name="login-2" className="size-4" />{t('home.joinCode')}
          </button>
        </div>

        {/* The code field costs a whole row, so it only appears once somebody asks for it. */}
        {joining && (
          <div className="home-join">
            <input
              className="home-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder={t('home.code.ph')} maxLength={4} autoCapitalize="characters" autoComplete="off"
              aria-label={t('home.code.ph')} dir="ltr" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') go('join'); }}
            />
            <Button size="lg" variant="primary" className="home-join-go" isPending={busy === 'join'} onPress={() => go('join')}>
              {t('home.join')}
            </Button>
          </div>
        )}

        <div className="home-foot-row">
          {s.account && !s.account.isGuest ? (
            <span className="home-acct">
              {s.account.avatarUrl && <img className="acct-photo" src={s.account.avatarUrl} alt="" referrerPolicy="no-referrer" />}
              <span className="acct-name">{s.account.name}</span>
              <button type="button" className="acct-link" onClick={signOutAccount}>{t('acct.signout')}</button>
            </span>
          ) : (
            <button type="button" className="home-acct acct-google" onClick={signInWithGoogle} disabled={!isConfigured}>
              <GoogleG className="size-4" />{t('acct.google')}
            </button>
          )}
          <span className="home-links">
            <button type="button" className="home-howto" onClick={() => store.set({ modal: 'guide' })}>{t('coach.rules')}</button>
            {/* A reachable privacy policy is a hard requirement for both AdSense and Analytics.
                It is a static page under public/ so crawlers (and the AdSense reviewer) can read it. */}
            <a className="home-privacy" href="/privacy.html" target="_blank" rel="noopener">{t('home.privacy')}</a>
          </span>
        </div>
      </div>
    </section>
  );
}
