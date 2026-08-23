/** Branding, art and per-character data. Images come from /public/img (built by `npm run assets`). */
export type CharacterId = 'taxman' | 'businesswoman' | 'police' | 'terrorist' | 'colonel' | 'politician' | 'thief';

export const CHARACTERS: CharacterId[] = ['taxman', 'businesswoman', 'police', 'terrorist', 'colonel', 'politician', 'thief'];

export const THEME = {
  brand: { name: 'ELMAKINA', tagline: 'Identity • Deception • Deduction' },
  slideshowMs: 5000,
  img: {
    bg: ['/assets/background-lobby.png'],
    bgSmall: ['/assets/background-lobby.png'],
    poster: '/img/poster.webp',
    machine: '/img/machine.webp',
    machineSmall: '/img/machine-sm.webp',
    cardBack: '/img/card-back.webp',
    coin: '/img/coin.webp',
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

export const DEFAULT_AVATARS = ['boy-1', 'boy-2', 'boy-3', 'boy-4', 'boy-5', 'boy-6', 'girl-1', 'girl-2', 'girl-3', 'girl-4', 'girl-5', 'girl-6'];
export const PALETTE = CHARACTERS.map((c) => ({ color: CH[c].color.toLowerCase(), name: c }));

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
