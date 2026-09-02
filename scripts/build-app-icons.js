'use strict';
/**
 * Source images for the native app icon and splash  (run: npm run appicons)
 *
 * Writes assets/, which @capacitor/assets then expands into every Android density and iOS size.
 * The logo is public/img/machine.webp — the same mark the PWA icon and the web splash already use,
 * so the phone icon, the installed web app and the loading screen stay one brand.
 *
 * The two icon files are NOT the same crop, and that is the point:
 *
 *   icon-only        the legacy square icon. The mark can run close to the edge.
 *   icon-foreground  the adaptive icon, which Android MASKS to a circle, squircle or whatever
 *                    shape the launcher prefers, and which it also parallaxes on some phones.
 *                    Only the middle ~66% is guaranteed to survive, so the mark is scaled down to
 *                    sit inside that. Reusing the legacy crop here is the classic mistake: it looks
 *                    right in the folder and arrives on the phone with its corners sliced off.
 */
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const LOGO = path.join(root, 'public', 'img', 'machine.webp');
const out = (f) => path.join(root, 'assets', f);

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
// The app's own dark, matching background_color in the manifest and theme-color in index.html.
const INK = { r: 14, g: 11, b: 8, alpha: 1 };

/**
 * Alpha below this is keying residue, not artwork.
 *
 * public/img/machine.webp comes out of `npm run assets`, which keys the studio backdrop out of
 * logo.png to transparency. That keying leaves a faint speckle across the old backdrop, far too
 * dim to see but not actually zero — so a plain alpha trim keeps it and reports the mark as
 * 737x883 when the real drawing is 737x651. The 232px of "logo" above the machine is empty.
 *
 * That is why the first icon looked low in its circle: the artwork was being centred inside a
 * bounding box a fifth of which was invisible noise. Measured across thresholds, the box is
 * identical anywhere from 64 to 128, which is a wide flat plateau and a safe place to cut.
 */
const ALPHA_FLOOR = 64;

/**
 * The logo — cropped to what is actually drawn — fitted inside a `box`x`box` square.
 *
 * BOTH dimensions are constrained. Constraining width alone, the obvious way to write this, let
 * the height run past the adaptive icon's safe zone and the launcher's mask shaved the top and
 * bottom off.
 */
let _cropped = null;
/** The logo cropped to what is actually drawn, memoised. */
async function cropped() {
  if (_cropped) return _cropped;
  const trimmed = await sharp(LOGO).ensureAlpha().trim().toBuffer();
  const { data, info } = await sharp(trimmed).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > ALPHA_FLOOR) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  _cropped = await sharp(trimmed)
    .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
    .toBuffer();
  return _cropped;
}

/** The cropped logo fitted inside a `box`x`box` square. Both axes are constrained: the mark is
 *  taller than it is wide, so constraining width alone lets the height run past the target. */
async function mark(box) {
  return sharp(await cropped())
    .resize({ width: box, height: box, fit: 'inside', withoutEnlargement: false })
    .toBuffer();
}

/**
 * The logo scaled so that every ink pixel sits inside a circle of `radius` px, centred.
 *
 * Adaptive icons are MASKED, and the mask is a circle (or a squircle, or whatever the launcher
 * fancies) — not a square. Fitting the bounding BOX inside the safe square is not the same test and
 * is the one I got wrong first: the box fitted, and the corners of a rectangular illustration still
 * poked outside the circle and were sliced off. 1101 pixels of the machine, measured.
 *
 * So the test is the distance of the furthest ink pixel from centre, which is the only thing the
 * mask actually cares about. Measured on the real artwork, so it stays correct if the logo changes.
 */
async function markInCircle(radius) {
  const art = await cropped();
  const { data, info } = await sharp(art).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let maxR = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > ALPHA_FLOOR) {
        const r = Math.hypot(x - W / 2, y - H / 2);
        if (r > maxR) maxR = r;
      }
    }
  }
  const scale = (radius / maxR) * 0.98;   // 2% so antialiased edges do not graze the mask
  return sharp(art).resize({ width: Math.round(W * scale), height: Math.round(H * scale) }).toBuffer();
}

/** Centre `buf` on a `size` square of `bg`. */
async function centred(buf, size, bg, file) {
  const m = await sharp(buf).metadata();
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([{ input: buf, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }])
    .png()
    .toFile(out(file));
  console.log(`  assets/${file}  ${size}×${size}`);
}

(async () => {
  if (!fs.existsSync(LOGO)) throw new Error(`missing ${LOGO} — run \`npm run assets\` first`);
  fs.mkdirSync(path.join(root, 'assets'), { recursive: true });

  console.log('App icon (logo on white)');
  await centred(await mark(800), 1024, WHITE, 'icon-only.png');          // legacy square
  // 66dp of the 108dp adaptive canvas is the circle guaranteed to survive every launcher mask.
  await centred(await markInCircle(0.5 * (66 / 108) * 1024), 1024, { ...WHITE, alpha: 0 }, 'icon-foreground.png');
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: WHITE } })
    .png().toFile(out('icon-background.png'));
  console.log('  assets/icon-background.png  1024×1024');

  // Splash is square and oversized on purpose: Capacitor centre-crops one source to every phone
  // shape, so the mark must survive both a tall portrait and a wide landscape crop.
  console.log('Splash (logo on the app dark)');
  await centred(await mark(620), 2732, INK, 'splash.png');
  await centred(await mark(620), 2732, INK, 'splash-dark.png');
})();
