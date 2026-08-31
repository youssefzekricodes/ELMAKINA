'use strict';
/**
 * Colour the flat-grey icons  (run: npm run icons)
 *
 * The set ships its navigation marks in a three-step grey ramp — #DADADA / #C6C6C6 / #B2B2B2 for
 * light, mid and shade. That is a gift: swapping those three hexes for a colour ramp of the same
 * three steps recolours the illustration without touching its shading, so a tinted icon still
 * looks drawn rather than filtered. Sources stay untouched; each tint is written alongside as
 * `<name>-c.svg`, and re-running is idempotent.
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'public', 'img', 'icons');
/** light, mid, shade — the same order as the grey ramp they replace. */
const RAMP = {
  amber:  ['#FFE08A', '#F3C24E', '#CE9524'],
  blue:   ['#BFDAFF', '#82B2F2', '#4C82D2'],
  ember:  ['#FFC79E', '#F2894A', '#CB5F1E'],   // the app's own accent, as a three-step ramp
  green:  ['#CBF0AC', '#92D46C', '#5FA63C'],
  violet: ['#DDC7F7', '#B58EE9', '#8659C7'],
};
const GREY = ['#DADADA', '#C6C6C6', '#B2B2B2'];

/** name → [ramp, extra hex swaps for icons that are not pure grey] */
const PLAN = {
  home: ['ember'],
  menu: ['blue'],
  profile: ['violet'],
  achievements: ['amber'],
  'sound-on': ['blue'],
  'sound-off': ['blue'],
  // the pad is already part-coloured: its shell greys go green, its lit buttons stay as drawn
  gamepad: ['green', { '#B7B7B7': '#92D46C', '#D7D7D7': '#CBF0AC', '#E1E1E1': '#CBF0AC' }],
};

let n = 0;
for (const [name, [rampName, extra]] of Object.entries(PLAN)) {
  const src = path.join(DIR, `${name}.svg`);
  if (!fs.existsSync(src)) { console.log(`  (${name}.svg absent — skipped)`); continue; }
  let svg = fs.readFileSync(src, 'utf8');
  const ramp = RAMP[rampName];
  GREY.forEach((grey, i) => { svg = svg.split(grey).join(ramp[i]).split(grey.toLowerCase()).join(ramp[i]); });
  for (const [from, to] of Object.entries(extra || {})) svg = svg.split(from).join(to).split(from.toLowerCase()).join(to);
  const out = path.join(DIR, `${name}-c.svg`);
  fs.writeFileSync(out, svg);
  console.log(' ', `${name}-c.svg`, `(${rampName})`, Math.round(fs.statSync(out).size / 1024) + ' KB');
  n++;
}
console.log(`Done — ${n} icon(s) tinted.`);
