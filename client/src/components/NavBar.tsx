/**
 * The main nav: five stops with Home raised out of the middle.
 *
 * Built on the reference's shape — a shelf with a lifted centre — but in this game's material:
 * dark glass over the table art, a brass hairline along the top, and the active stop lit in the
 * accent rather than pastel blue. Only the active stop is labelled; the other four are their icon
 * alone, which is what keeps five of them on a 390px phone.
 *
 * On desktop it does not stretch edge to edge — it becomes a floating dock, centred and capped,
 * so a 1600px window gets the same object rather than a 1600px-wide strip of chrome.
 */
import { store, useStore } from '../lib/store';
import { t } from '../i18n';
import { Art } from './ui';
import type { ArtName } from '../art';

type Screen = 'home' | 'leaderboard' | 'friends' | 'public';
/** Where the bar is allowed to appear: the lobby has its own bottom bar, and a game needs the room. */
export const NAV_SCREENS: string[] = ['home', 'leaderboard', 'friends', 'public'];

type Stop = { key: string; art: ArtName; label: string; go: () => void; badge?: number; centre?: boolean; active: boolean };

export function NavBar() {
  const s = useStore();
  const at = (screen: Screen) => s.screen === screen && !s.modal;
  const stops: Stop[] = [
    { key: 'leaderboard', art: 'cupGold', label: t('lb.title'), go: () => store.set({ screen: 'leaderboard' }), active: at('leaderboard') },
    { key: 'public', art: 'menu', label: t('home.public'), go: () => store.set({ screen: 'public' }), active: at('public') },
    { key: 'home', art: 'home', label: t('nav.home'), go: () => store.set({ screen: 'home' }), centre: true, active: at('home') },
    { key: 'friends', art: 'gamepad', label: t('fr.title'), go: () => store.set({ screen: 'friends' }), badge: s.friendReqs.length, active: at('friends') },
    { key: 'profile', art: 'profile', label: t('profile.title'), go: () => store.set({ modal: 'avatar' }), active: s.modal === 'avatar' },
  ];
  return (
    <nav className="navbar" aria-label={t('nav.title')}>
      <div className="nav-shelf">
        {stops.map((n) => (
          <button
            key={n.key} type="button" onClick={n.go}
            className={`nav-stop ${n.centre ? 'centre' : ''} ${n.active ? 'on' : ''}`}
            aria-current={n.active ? 'page' : undefined} aria-label={n.label} title={n.label}
          >
            <span className="nav-ic">
              <Art name={n.art} className="nav-art" />
              {!!n.badge && <span className="nav-badge">{n.badge > 9 ? '9+' : n.badge}</span>}
            </span>
            <span className="nav-label">{n.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
