import { useEffect } from 'react';
import { Toast } from '@heroui/react';
import { useStore, store } from './lib/store';
import { connect, setLanguage } from './lib/net';
import { goFullscreen } from './lib/fullscreen';
import { sfx } from './lib/sfx';
import { initAnalytics, sendPageView } from './lib/analytics';
import { initAds } from './lib/ads';
import { i18n } from './i18n';
import { CH, CHARACTERS } from './theme';
import { Background } from './components/Background';
import { TopBar } from './components/TopBar';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Table } from './components/Table';
import { Console } from './components/Console';
import { LogPanel } from './components/LogPanel';
import { Prompt } from './components/Prompt';
import { AvatarPicker, CharactersModal, RulesModal } from './components/Modals';
import { LeaderboardPage, FriendsPage, PublicRoomsPage, InviteModal, InviteBanner } from './components/Social';
import { VoiceDock } from './components/VoiceDock';
import { Reactions } from './components/Reactions';
import { Cinematic } from './components/Cinematic';
import { NetBadge } from './components/NetBadge';
import { Coach } from './components/Coach';

// Voice chat is hidden for now (kept in the tree so it can be flipped back on in one place).
const VOICE_ENABLED = false;
import { Guide } from './components/Guide';
import { Tour } from './components/Tour';

export default function App() {
  const s = useStore();
  useEffect(() => {
    // invite link / language param, then connect
    const params = new URLSearchParams(location.search);
    if (params.get('room')) store.set({ autoJoinCode: params.get('room')!.toUpperCase() });
    if (params.get('lang')) setLanguage(params.get('lang')!); else setLanguage(i18n.lang);
    const unlock = () => sfx.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });
    for (const c of CHARACTERS) { new Image().src = CH[c].card; new Image().src = CH[c].cardSm; }
    connect();
    initAnalytics();
    initAds(); // fetch the ad script early so the first break is not what loads it
    (window as any).__mekina = { store }; // debugging hook (inspect / inject state from the console)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') store.set({ logOpen: false, modal: null }); }; // Esc also dismisses any sheet
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  // One "page" per screen: the app is a single route with the screen held in the store, so GA's
  // automatic page_view would fire exactly once for a whole session.
  useEffect(() => { sendPageView('/' + s.screen); }, [s.screen]);
  const inGame = s.screen === 'game' && !!s.state;
  // Auto-fullscreen when a game begins (best-effort; the start-game clicks also request it within their gesture).
  useEffect(() => { if (inGame) goFullscreen(); }, [inGame]);
  return (
    <>
      <Background inGame={inGame} screen={s.screen} />
      <div id="app" className={`app ${inGame ? 'in-game' : ''}`} dir={i18n.dir()}>
        <TopBar />
        {s.screen === 'home' && <Home />}
        {s.screen === 'leaderboard' && <LeaderboardPage />}
        {s.screen === 'friends' && <FriendsPage />}
        {s.screen === 'public' && <PublicRoomsPage />}
        {s.screen === 'lobby' && s.room && <Lobby />}
        {inGame && (
          <section className="screen game-screen">
            <div className={`game-grid ${s.logCollapsed ? 'log-collapsed' : ''}`}>
              <Table />
              <LogPanel />
              <Console />
            </div>
            <Prompt />
            <Tour />
          </section>
        )}
      </div>
      {VOICE_ENABLED && s.room && <VoiceDock />}
      {inGame && <Reactions />}
      {/* The briefing prefers the lobby, where no clock is running; Coach decides for itself. */}
      <Coach />
      {inGame && <Cinematic />}
      <NetBadge />
      <RulesModal />
      <CharactersModal />
      <Guide />
      <InviteModal />
      <InviteBanner />
      <AvatarPicker />
      <Toast.Provider placement="top" maxVisibleToasts={3} />
      <div id="fx" className="fx-root" aria-hidden="true" />
    </>
  );
}
