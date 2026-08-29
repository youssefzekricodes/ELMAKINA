'use strict';
/**
 * iOS PWA startup images  (run: npm run splash)
 *
 * Android and desktop Chrome build a splash from manifest.webmanifest (name + background_color +
 * the 512px icon). iOS ignores all of that: an installed PWA opens on a WHITE flash unless the page
 * declares apple-touch-startup-image links at the EXACT device resolution, per orientation. So we
 * generate them — a flat brand background with the emblem centred, matching the inline #splash in
 * client/index.html so the handoff is invisible.
 *
 * Output: public/img/splash/<w>x<h>.png plus the <link> block to paste into client/index.html
 * (printed at the end; the tags are already there — rerun only if this list changes).
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const LOGO = path.join(ROOT, 'public', 'img', 'machine.webp');
const OUT = path.join(ROOT, 'public', 'img', 'splash');
const BG = { r: 14, g: 11, b: 8, alpha: 1 };   // #0E0B08, the same ground as the web splash

/** Device pixel sizes iOS matches on. Portrait entries; each also emits its landscape swap. */
const DEVICES = [
  [640, 1136, 2],   // iPhone SE 1st gen
  [750, 1334, 2],   // iPhone 8 / SE 2-3
  [828, 1792, 2],   // iPhone XR / 11
  [1125, 2436, 3],  // iPhone X / XS / 11 Pro
  [1170, 2532, 3],  // iPhone 12 / 13 / 14
  [1179, 2556, 3],  // iPhone 14 Pro / 15 / 16
  [1242, 2688, 3],  // iPhone XS Max / 11 Pro Max
  [1284, 2778, 3],  // iPhone 12/13 Pro Max
  [1290, 2796, 3],  // iPhone 14 Pro Max / 15 Pro Max
  [1536, 2048, 2],  // iPad 9.7 / mini / Air
  [1620, 2160, 2],  // iPad 10.2
  [1668, 2388, 2],  // iPad Pro 11
  [2048, 2732, 2],  // iPad Pro 12.9
];

async function one(w, h) {
  // The mark occupies ~30% of the short edge — the same visual weight as min(38vw, 168px) on the web.
  const mark = Math.round(Math.min(w, h) * 0.3);
  const logo = await sharp(LOGO).resize({ width: mark, height: mark, fit: 'inside' }).png().toBuffer();
  const m = await sharp(logo).metadata();
  const file = path.join(OUT, `${w}x${h}.png`);
  await sharp({ create: { width: w, height: h, channels: 4, background: BG } })
    .composite([{ input: logo, left: Math.round((w - m.width) / 2), top: Math.round((h - m.height) / 2) }])
    // A flat ground with one mark: an 8-bit palette costs nothing visually and keeps these tiny.
    .png({ palette: true, quality: 90, effort: 8 })
    .toFile(file);
  return file;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const links = [];
  let total = 0;
  for (const [w, h, ratio] of DEVICES) {
    for (const [a, b, orient] of [[w, h, 'portrait'], [h, w, 'landscape']]) {
      const file = await one(a, b);
      total += fs.statSync(file).size;
      const cssW = Math.round(w / ratio), cssH = Math.round(h / ratio);
      links.push(
        `    <link rel="apple-touch-startup-image" href="/img/splash/${a}x${b}.png"` +
        ` media="(device-width: ${cssW}px) and (device-height: ${cssH}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orient})" />`,
      );
    }
  }
  console.log(`${links.length} images, ${Math.round(total / 1024)} KB total\n`);
  console.log(links.join('\n'));
})();
