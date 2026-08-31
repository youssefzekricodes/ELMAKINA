/** Branding, art and per-character data. Images come from /public/img (built by `npm run assets`). */
export type CharacterId = 'taxman' | 'businesswoman' | 'police' | 'terrorist' | 'colonel' | 'politician' | 'thief';

export const CHARACTERS: CharacterId[] = ['taxman', 'businesswoman', 'police', 'terrorist', 'colonel', 'politician', 'thief'];

export const THEME = {
  brand: { name: 'ELMEKINA', tagline: 'Identity • Deception • Deduction' },
  slideshowMs: 5000,
  img: {
    // The room, every screen. Built by `npm run assets` from assets/background-game.png — the
    // lobby PNG it replaces was 2 MB of unoptimised art on the very first paint.
    bg: ['/img/bg-game.webp'],
    bgSmall: ['/img/bg-game-sm.webp'],
    // The same room framed upright, for a screen taller than it is wide. `cover` on the landscape
    // art crops a phone down to a sliver of its middle; this one is composed for the shape.
    bgTall: ['/img/bg-portrait.webp'],
    bgTallSmall: ['/img/bg-portrait-sm.webp'],
    poster: '/img/poster.webp',
    machine: '/img/machine.webp',
    machineSmall: '/img/machine-sm.webp',
    cardBack: '/img/card-back.webp',
    coin: '/img/icons/coins.svg',   // the illustrated set's coin (see art.ts) — one currency, one look
  },
  characters: {
    taxman: { name: 'Tax Man', color: '#2f7d32', card: '/img/cards/taxman.webp', cardSm: '/img/cards/taxman-sm.webp' },
    businesswoman: { name: 'Business Woman', color: '#d7a800', card: '/img/cards/businesswoman.webp', cardSm: '/img/cards/businesswoman-sm.webp' },
    police: { name: 'Police', color: '#1e4fb5', card: '/img/cards/police.webp', cardSm: '/img/cards/police-sm.webp' },
    terrorist: { name: 'Terrorist', color: '#b3261e', card: '/img/cards/terrorist.webp', cardSm: '/img/cards/terrorist-sm.webp' },
    colonel: { name: 'Colonel', color: '#4b6b2b', card: '/img/cards/colonel.webp', cardSm: '/img/cards/colonel-sm.webp' },
    politician: { name: 'Politician', color: '#5b2d9e', card: '/img/cards/politician.webp', cardSm: '/img/cards/politician-sm.webp' },
    thief: { name: 'Thief', color: '#b5561a', card: '/img/cards/thief.webp', cardSm: '/img/cards/thief-sm.webp' },
  } as Record<CharacterId, { name: string; color: string; card: string; cardSm: string }>,
};

export const CH = THEME.characters;
export const IMG = THEME.img;

/** Card art for the safe (non-character) moves — these are played as cards too. */
export const ACTION_CARDS: Record<string, string> = {
  income: '/img/cards/take-coin.png',
  loan: '/img/cards/take-2coins.png',
  paidkill: '/img/cards/pay-7-to-eliminate.png',
};

export const DEFAULT_AVATARS = ['boy-1', 'boy-2', 'boy-3', 'boy-4', 'boy-5', 'boy-6', 'girl-1', 'girl-2', 'girl-3', 'girl-4', 'girl-5', 'girl-6'];
export const PALETTE = CHARACTERS.map((c) => ({ color: CH[c].color.toLowerCase(), name: c }));

/**
 * Readable ink for a solid fill of `hex` — WCAG relative luminance, not a guess.
 * Every character that can currently appear on a counter button clears 4.5:1 against white
 * (thief 4.87 is the tightest), but the Business Woman's yellow would be 2.21, so picking the
 * foreground by measurement means a future rule change can't silently ship white-on-yellow.
 */
export function inkOn(hex: string): string {
  const ch = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#12100C' : '#FFFFFF';
}

export type ActionType = 'income' | 'loan' | 'paidkill' | CharacterId;
export interface ActionDef { type: ActionType; cost: number; kind: 'default' | 'claim'; target?: 'others' | 'rich' | 'any' | 'coins' }
export const ACTIONS: ActionDef[] = [
  { type: 'income', cost: 0, kind: 'default' },
  { type: 'loan', cost: 0, kind: 'default' },
  { type: 'paidkill', cost: 7, kind: 'default', target: 'others' },
  { type: 'businesswoman', cost: 0, kind: 'claim' },
  { type: 'taxman', cost: 0, kind: 'claim', target: 'rich' },
  { type: 'police', cost: 0, kind: 'claim', target: 'any' },
  { type: 'terrorist', cost: 3, kind: 'claim', target: 'others' },
  { type: 'colonel', cost: 4, kind: 'claim', target: 'others' },
  { type: 'politician', cost: 0, kind: 'claim' },
  { type: 'thief', cost: 0, kind: 'claim', target: 'coins' },
];
