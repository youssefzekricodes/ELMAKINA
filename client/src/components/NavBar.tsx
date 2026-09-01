/**
 * The bottom tab bar, built from the supplied artwork.
 *
 * shape.svg is the bar itself — a 347×67 pill with an arched top and an inner highlight — stretched
 * to the width it is given, so the arch keeps its proportions on any phone. The five marks are the
 * supplied icons at their own sizes; nothing here recolours or filters them, because they arrive
 * already drawn.
 *
 * The tab you are on lifts out of the bar into a white disc and is the only one that says its name.
 * That is the whole of the design: one thing raised, one thing labelled, everything else quiet.
 *
 * Phones and tablets only. On a desktop the same five icons live in the header row instead (see
 * Home), and in a game there is no navigating anywhere — the board owns the screen.
 */
import { useStore, store, type Snapshot } from '../lib/store';
import { t } from '../i18n';

type Screen = Snapshot['screen'];
// Home in the middle, where the thumb lands and where a raised disc has room on both sides — it is
// also the one tab that is never at a rounded corner.
const TABS: { id: string; screen: Screen; icon: string; label: string }[] = [
  { id: 'leaderboard', screen: 'leaderboard', icon: '/img/navbar/leaderboard.svg', label: 'lb.title' },
  { id: 'rooms', screen: 'public', icon: '/img/navbar/rooms.svg', label: 'home.public' },
  { id: 'home', screen: 'home', icon: '/img/navbar/home.svg', label: 'nav.home' },
  { id: 'friends', screen: 'friends', icon: '/img/navbar/friends.svg', label: 'fr.title' },
  // Settings goes to the profile screen — characters, rules, sound, music, language, notifications
  // and the account all already live there — but it is LABELLED settings, because that is what the
  // gear promises. Borrowing the profile screen's own title put "your look" under a cog.
  { id: 'settings', screen: 'profile', icon: '/img/navbar/settings.svg', label: 'set.title' },
];

export function NavBar() {
  const s = useStore();
  if (s.screen === 'game' || s.screen === 'lobby' || s.onboarding) return null;
  return (
    <nav className="tabbar" aria-label={t('nav.title')}>
      <ul className="tb-list">
        {TABS.map((tab) => {
          const on = s.screen === tab.screen;
          const name = t(tab.label);
          return (
            <li key={tab.id} className={`tb-item ${on ? 'on' : ''}`}>
              <button type="button" className="tb-btn" aria-current={on ? 'page' : undefined}
                onClick={() => store.set({ screen: tab.screen })} aria-label={name} title={name}>
                <span className="tb-mark"><img src={tab.icon} alt="" draggable={false} /></span>
                {on && <span className="tb-name">{name}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The same five, for the header row on a desktop — where there is no bar to put them in. */
export function NavIcons() {
  const s = useStore();
  return (
    <>
      {TABS.filter((tab) => tab.screen !== 'home').map((tab) => {
        const name = t(tab.label);
        return (
          <button key={tab.id} type="button" className={`nav-ico ${s.screen === tab.screen ? 'on' : ''}`}
            onClick={() => store.set({ screen: tab.screen })} title={name}>
            <img src={tab.icon} alt="" draggable={false} />
            <span className="nav-ico-tx">{name}</span>
            {tab.id === 'friends' && s.friendReqs.length > 0 && <span className="acct-badge">{s.friendReqs.length}</span>}
          </button>
        );
      })}
    </>
  );
}
