/**
 * Illustrated icons (public/img/icons) — full-colour SVGs that carry their own palette.
 *
 * Distinct from icons.ts, whose line glyphs are drawn in currentColor and take the colour of
 * whatever they sit in. These follow the set's own pattern: anything you navigate WITH is grey
 * (home, menu, profile, sound, gamepad), and anything you WIN is gold or blue (stars, coins,
 * cups, the clock). Rendered as <img>, never inlined, so the browser caches one copy each.
 */
export const ART = {
  timer: '/img/icons/timer.svg',
  // The trophy token, in the game's own gold — it replaces the generic stars everywhere a trophy
  // count is shown, so the thing you win looks like one thing wherever it appears.
  stars: '/img/icons/tokens.svg',
  coins: '/img/icons/coins.svg',
  cupGold: '/img/icons/cup-gold.svg',
  cupSilver: '/img/icons/cup-silver.svg',
  cupBronze: '/img/icons/cup-bronze.svg',
  // `-c` = the tinted build of a mark the set ships in flat grey (see scripts/tint-icons.js).
  // Grey reads as "disabled" in a game, and the nav is the last place that should look switched off.
  soundOn: '/img/icons/sound-on-c.svg',
  soundOff: '/img/icons/sound-off-c.svg',
  // Teal, where the sound switch is blue: two mute buttons side by side have to be told apart
  // before they are read.
  musicOn: '/img/icons/music-c.svg',
  musicOff: '/img/icons/music-off-c.svg',
  profile: '/img/icons/profile-c.svg',
  menu: '/img/icons/menu-c.svg',
  home: '/img/icons/home-c.svg',
  gamepad: '/img/icons/gamepad-c.svg',
  achievements: '/img/icons/achievements-c.svg',
  cards: '/img/icons/cards.svg',
  // the front door's four ways in
  dungeon: '/img/icons/dungeon.svg',
  gamepadSolo: '/img/icons/gamepad-solo.svg',
  key: '/img/icons/key.svg',
  screw: '/img/icons/screw.svg',
  flagTn: '/img/icons/flag-tn.svg',
  flagEn: '/img/icons/flag-en.svg',
} as const;

export type ArtName = keyof typeof ART;
/** 1st, 2nd, 3rd — the cup that goes with a finishing place, or null for the rest of the field. */
export const cupFor = (rank: number): ArtName | null => (rank === 1 ? 'cupGold' : rank === 2 ? 'cupSilver' : rank === 3 ? 'cupBronze' : null);
