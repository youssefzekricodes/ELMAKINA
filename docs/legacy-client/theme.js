/**
 * ELMAKINA theme — branding, art and per-character data.
 * Images are produced from /public/assets by `npm run assets` (see scripts/build-assets.js).
 */
window.MEKINA_THEME = {
  brand: { name: 'ELMAKINA', tagline: 'Identity • Deception • Deduction' },
  slideshowMs: 5000,
  img: {
    bg: ['img/bg-1.webp', 'img/bg-2.webp'],
    bgSmall: ['img/bg-1-sm.webp', 'img/bg-2-sm.webp'],
    poster: 'img/poster.webp',
    machine: 'img/machine.webp',
    machineSmall: 'img/machine-sm.webp',
    cardBack: 'img/card-back.webp',
    coin: 'img/coin.webp',
  },
  characters: {
    taxman:        { name: 'Tax Man',        color: '#2f7d32', card: 'img/cards/taxman.webp',        cardSm: 'img/cards/taxman-sm.webp',        blurb: 'Wealth tax: take 1 coin from a player holding more than 7. Reactively: take 1 of the Business Woman\'s 4 coins, or veto any Loan.' },
    businesswoman: { name: 'Business Woman', color: '#d7a800', card: 'img/cards/businesswoman.webp', cardSm: 'img/cards/businesswoman-sm.webp', blurb: 'Take 4 coins from the bank. Every other player may claim Tax Man to take 1 of them.' },
    police:        { name: 'Police',         color: '#1e4fb5', card: 'img/cards/police.webp',        cardSm: 'img/cards/police-sm.webp',        blurb: 'Secretly look at one card of any player (yourself included); leave it or swap it with the deck. Anyone may block with Police.' },
    terrorist:     { name: 'Terrorist',      color: '#b3261e', card: 'img/cards/terrorist.webp',     cardSm: 'img/cards/terrorist-sm.webp',     blurb: 'Pay 3 coins: kill one card of a player. Anyone may block with Colonel.' },
    colonel:       { name: 'Colonel',        color: '#4b6b2b', card: 'img/cards/colonel.webp',       cardSm: 'img/cards/colonel-sm.webp',       blurb: 'Pay 4 coins: guess a card in a hand. Right → they lose it. Wrong → you lose a random card and they get the 4 coins. Blocks Terrorist.' },
    politician:    { name: 'Politician',     color: '#5b2d9e', card: 'img/cards/politician.webp',    cardSm: 'img/cards/politician-sm.webp',    blurb: 'Return all your cards to the deck and draw the same number.' },
    thief:         { name: 'Thief',          color: '#b5561a', card: 'img/cards/thief.webp',         cardSm: 'img/cards/thief-sm.webp',         blurb: 'Steal 2 coins from a player. Anyone may block with Thief.' },
  },
};
