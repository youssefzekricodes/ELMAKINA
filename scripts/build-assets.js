'use strict';
/**
 * Build optimized game assets from public/assets → public/img  (run: npm run assets)
 *  - backgrounds/poster → WebP (2 sizes)
 *  - character cards → WebP 360w + 180w
 *  - machine (logo.png) → WebP with the light-grey backdrop keyed to transparent
 *  - card back → crop of the poster, WebP
 *  - coin → 128px WebP, favicon → 64px PNG
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'public', 'assets');
const OUT = path.join(__dirname, '..', 'public', 'img');
fs.mkdirSync(path.join(OUT, 'cards'), { recursive: true });
const src = (f) => path.join(SRC, f);
const out = (f) => path.join(OUT, f);
const kb = (f) => Math.round(fs.statSync(f).size / 1024) + ' KB';

async function webp(input, output, width, quality = 80, extra = (s) => s) {
  await extra(sharp(input).resize({ width, withoutEnlargement: true })).webp({ quality }).toFile(output);
  console.log(' ', path.relative(OUT, output), kb(output));
}

/** Make near-background (light grey) pixels transparent, with a soft edge. */
async function keyOutBackground(input, output, width) {
  const img = sharp(input).resize({ width, withoutEnlargement: true }).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const bg = [data[0], data[1], data[2]]; // top-left pixel = backdrop colour
  const px = data.length / 4;
  for (let i = 0; i < px; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const d = Math.sqrt((r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2);
    // d < 14 → fully transparent, d > 60 → opaque; soft ramp in between (keeps the drop shadow)
    const a = d < 14 ? 0 : d > 60 ? 255 : Math.round(((d - 14) / 46) * 255);
    data[i * 4 + 3] = Math.min(data[i * 4 + 3], a);
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).trim({ threshold: 10 }).webp({ quality: 85 }).toFile(output);
  console.log(' ', path.relative(OUT, output), kb(output));
}

(async () => {
  console.log('Backgrounds');
  await webp(src('background.png'), out('bg-1.webp'), 1600, 78);
  await webp(src('background.png'), out('bg-1-sm.webp'), 900, 74);
  await webp(src('background-2.png'), out('bg-2.webp'), 1600, 78);
  await webp(src('background-2.png'), out('bg-2-sm.webp'), 900, 74);
  await webp(src('card-back.png'), out('poster.webp'), 900, 78);

  console.log('Machine (keyed)');
  await keyOutBackground(src('logo.png'), out('machine.webp'), 1000);
  await keyOutBackground(src('logo.png'), out('machine-sm.webp'), 560);

  console.log('Card back (machine logo on white)');
  {
    const W = 360, H = 590;
    const logo = await sharp(out('machine.webp')).trim({ threshold: 60 }).resize({ width: 250 }).toBuffer();
    const lm = await sharp(logo).metadata();
    const frame = Buffer.from(`<svg width="${W}" height="${H}"><rect x="9" y="9" width="${W - 18}" height="${H - 18}" rx="14" ry="14" fill="none" stroke="#d9d2c3" stroke-width="3"/></svg>`);
    await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } })
      .composite([{ input: frame }, { input: logo, left: Math.round((W - lm.width) / 2), top: Math.round((H - lm.height) / 2) }]).webp({ quality: 85 }).toFile(out('card-back.webp'));
    console.log(' ', 'card-back.webp', kb(out('card-back.webp')));
  }

  console.log('Cards');
  const cards = { taxman: 'tax-man.png', businesswoman: 'bussiness_women.png', police: 'police.png', terrorist: 'terrorist.png', colonel: 'colonel.png', politician: 'politician.png', thief: 'thief.png' };
  for (const [key, file] of Object.entries(cards)) {
    await webp(src(`characters/${file}`), out(`cards/${key}.webp`), 360, 82);
    await webp(src(`characters/${file}`), out(`cards/${key}-sm.webp`), 180, 78);
  }

  console.log('Avatars');
  fs.mkdirSync(path.join(OUT, 'avatars'), { recursive: true });
  for (const f of fs.readdirSync(path.join(SRC, 'avatars')).filter(f => /\.png$/i.test(f))) {
    const name = f.replace(/\.png$/i, '');
    await sharp(src(`avatars/${f}`)).resize({ width: 160, withoutEnlargement: true }).webp({ quality: 84, alphaQuality: 90 }).toFile(out(`avatars/${name}.webp`));
    console.log(' ', `avatars/${name}.webp`, kb(out(`avatars/${name}.webp`)));
  }

  console.log('Coin / favicon');
  await webp(src('golden-coin-money-dollar-icon.png'), out('coin.webp'), 128, 85);
  await sharp(src('logo.png')).extract({ left: 330, top: 330, width: 600, height: 600 }).resize(64, 64).png().toFile(out('favicon.png'));
  await sharp(src('logo.png')).extract({ left: 330, top: 330, width: 600, height: 600 }).resize(180, 180).png().toFile(out('apple-touch-icon.png'));
  console.log('  favicon.png', kb(out('favicon.png')));
  console.log('Done.');
})().catch((e) => { console.error(e); process.exit(1); });
