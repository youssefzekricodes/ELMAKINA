import { useEffect } from 'react';
import { Toast } from '@heroui/react';
import { useStore, store } from './lib/store';
import { connect, setLanguage } from './lib/net';
import { goFullscreen, isFullscreen, isHandheld, isInstalled } from './lib/fullscreen';
import { keepAudioAwake, sfx } from './lib/sfx';
import { initPulse } from './lib/pulse';
import { initAnalytics, sendPageView } from './lib/analytics';
import { initAds } from './lib/ads';
import { initUpdateCheck } from './lib/update';
import { music } from './lib/music';
import { i18n } from './i18n';
import { CH, CHARACTERS } from './theme';
import { Background } from './components/Background';
import { GameMenu } from './components/GameMenu';
import { QuickControls } from './components/QuickControls';
import { NavBar } from './components/NavBar';
import { Home } from './components/Home';
import { Lobby } from './components/Lobby';
import { Table } from './components/Table';
import { Console } from './components/Console';
import { LogPanel } from './components/LogPanel';
import { Prompt } from './components/Prompt';
import { AvatarPicker, CharactersModal, ConfirmDialog, RulesModal } from './components/Modals';
import { Onboarding } from './components/Onboarding';
import { UpdateGate } from './components/UpdateGate';
import { LeaderboardPage, FriendsPage, ProfilePage, PublicRoomsPage, InviteModal, InviteBanner } from './components/Social';
import { VoiceDock } from './components/VoiceDock';
import { Reactions } from './components/Reactions';
import { Spectating } from './components/Spectating';
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
    keepAudioAwake(); // …and keep it awake: an installed app is suspended and resumed all day long
    // The installed app is the one place the window is ours to take, and it is taken on the FIRST
    // touch of the front door — there is nothing about starting a game that should be the price of
    // a full screen. Standalone leaves the system bars in place and paints the strip under the page
    // with the manifest colour, which is the band showing under the artwork; fullscreen removes the
    // strip rather than trying to paint into it.
    //
    // It keeps asking until one attempt lands, because the first gesture is not always one the
    // browser counts — and then it stops for good. Somebody who leaves fullscreen on purpose is not
    // asking to be put back.
    const claim = () => {
      // Any handheld, not just the installed app. A phone browser keeps its own chrome AND the
      // system bars, which is the strip of dead space under the board — fullscreen is the only
      // thing that takes both back, and it is the whole reason the band was there.
      if (!isInstalled() && !isHandheld()) return document.removeEventListener('pointerdown', claim);
      goFullscreen();
      if (isFullscreen()) document.removeEventListener('pointerdown', claim);
    };
    document.addEventListener('pointerdown', claim);
    for (const c of CHARACTERS) { new Image().src = CH[c].card; new Image().src = CH[c].cardSm; }
    connect();
    initPulse();  // heartbeat + clock while a decision is mine to make
    initAnalytics();
    initAds(); // fetch the ad script early so the first break is not what loads it
    initUpdateCheck(); // a stale PWA is the one bug a user cannot work around
    (window as any).__mekina = { store, music, sfx }; // debugging hook (inspect / inject state from the console)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') store.set({ logOpen: false, modal: null }); }; // Esc also dismisses any sheet
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  // One "page" per screen: the app is a single route with the screen held in the store, so GA's
  // automatic page_view would fire exactly once for a whole session.
  useEffect(() => { sendPageView('/' + s.screen); }, [s.screen]);
  const inGame = s.screen === 'game' && !!s.state;
  /**
   * The bed plays over the whole front of house — the door, the lobby, the pages off it — and stops
   * when a hand starts. It lived in the lobby alone, which meant the only way to hear the game's own
   * music was to open a room first; the front door is where it belongs. In a game it would sit on
   * top of the cues that are telling you what just happened to you.
   */
  useEffect(() => {
    if (!inGame && s.musicOn) music.start(); else music.stop();
  }, [inGame, s.musicOn]);
  // Auto-fullscreen when a game begins (best-effort; the start-game clicks also request it within their gesture).
  useEffect(() => { if (inGame) goFullscreen(); }, [inGame]);
  return (
    <>
      <Background inGame={inGame} screen={s.screen} />
      <div id="app" className={`app ${inGame ? 'in-game' : ''} at-${s.screen}`} dir={i18n.dir()}>
        {s.screen === 'home' && <Home />}
        {s.screen === 'leaderboard' && <LeaderboardPage />}
        {s.screen === 'friends' && <FriendsPage />}
        {s.screen === 'public' && <PublicRoomsPage />}
        {s.screen === 'profile' && <ProfilePage />}
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
      {/* No screen has a header any more: in a game this gear is the whole of it, and everywhere
          else the two settings worth keeping stand on their own in the corner. */}
      {inGame && <GameMenu />}
      <QuickControls />
      {/* Phones and tablets navigate from the bar at the bottom; a desktop uses the header row on
          the front door instead (see Home / NavIcons). */}
      <NavBar />
      {/* Out of the game but still in the room: say it plainly, for as long as it is true. */}
      {inGame && <Spectating />}
      {/* The briefing prefers the lobby, where no clock is running; Coach decides for itself. */}
      <Coach />
      {inGame && <Cinematic />}
      <NetBadge />
      <UpdateGate />
      {/* The gate goes on top of everything: no header, no modals, no way to play nameless. */}
      {s.onboarding && <Onboarding />}
      <ConfirmDialog />
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
