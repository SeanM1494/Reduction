#!/usr/bin/env node
/**
 * scripts/brand-icons.mjs — every icon, splash and mark file the app and
 * the website ship, made from the four sources in brand/:
 *
 *   brand/reduction-icon.svg        the master artwork, full-bleed cream
 *   brand/reduction-icon-1024.png   rendered from it, RGB, NO alpha (App Store)
 *   brand/reduction-mark.svg        the same without the background
 *   brand/reduction-mark-1024.png   rendered from it, transparent
 *
 * Nothing here draws or alters the artwork. It COPIES the sources where a
 * full-size file is wanted and RESIZES the supplied PNGs where a smaller one
 * is: area-averaged in premultiplied alpha, because the mark's transparent
 * pixels are stored as transparent BLACK and a plain resize would pull that
 * black into every edge as a dark fringe. jimp (already an api-server
 * dependency, for recipe photos) only reads and writes the PNGs.
 *
 *   node scripts/brand-icons.mjs          write everything, report each file
 *   node scripts/brand-icons.mjs --check  write nothing; exit 1 if any output
 *                                         differs from what this would write
 *
 * Changing the artwork is: new files in brand/, then this script, then a
 * native build for the phone (the icon and splash are in the binary) and a
 * Publish for the website.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'artifacts/api-server/package.json'));
const { Jimp } = require('jimp');

const brand = (f) => path.join(root, 'brand', f);
const app = (f) => path.join(root, 'artifacts/reduction-mobile/assets/images', f);
const web = (f) => path.join(root, 'artifacts/reduction/public/brand', f);

/** Android's adaptive icon: a 108dp canvas of which only the central 66dp
 *  circle is promised to survive every launcher's mask. The mark reaches 500
 *  of the canvas's 512px from its centre, so it is scaled to 636/1024 (500 →
 *  310.5px, inside the 312.9px safe radius) and centered, over the icon's own
 *  cream as the background color (app.json). */
const ADAPTIVE_SCALE_PX = 636;

const check = process.argv.includes('--check');

/** Area-average resample in premultiplied alpha: every source pixel
 *  contributes to the destination pixels it overlaps, by the overlap. */
function resample(src, sw, sh, dw, dh) {
  const pre = new Float64Array(sw * sh * 4);
  for (let i = 0; i < sw * sh; i++) {
    const a = src[i * 4 + 3] / 255;
    pre[i * 4] = src[i * 4] * a;
    pre[i * 4 + 1] = src[i * 4 + 1] * a;
    pre[i * 4 + 2] = src[i * 4 + 2] * a;
    pre[i * 4 + 3] = src[i * 4 + 3];
  }
  const weights = (s, d) => {
    const scale = s / d;
    const out = [];
    for (let o = 0; o < d; o++) {
      const lo = o * scale;
      const hi = lo + scale;
      const taps = [];
      for (let i = Math.floor(lo); i < Math.min(s, Math.ceil(hi)); i++) {
        const w = Math.min(hi, i + 1) - Math.max(lo, i);
        if (w > 0) taps.push([i, w / scale]);
      }
      out.push(taps);
    }
    return out;
  };
  const wx = weights(sw, dw);
  const wy = weights(sh, dh);
  const mid = new Float64Array(dw * sh * 4);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < dw; x++)
      for (const [i, w] of wx[x])
        for (let c = 0; c < 4; c++) mid[(y * dw + x) * 4 + c] += pre[(y * sw + i) * 4 + c] * w;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const px = [0, 0, 0, 0];
      for (const [j, w] of wy[y]) for (let c = 0; c < 4; c++) px[c] += mid[(j * dw + x) * 4 + c] * w;
      const a = px[3];
      const o = (y * dw + x) * 4;
      if (a < 0.5) continue; // stays transparent black, like the source
      for (let c = 0; c < 3; c++) out[o + c] = Math.max(0, Math.min(255, Math.round(px[c] / (a / 255))));
      out[o + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  return out;
}

async function png(width, height, data, opaque) {
  const im = new Jimp({ width, height });
  im.bitmap.data = data;
  // colorType 2 is RGB: an opaque icon carries no alpha channel at all.
  return im.getBuffer('image/png', opaque ? { colorType: 2 } : {});
}

async function resized(source, size, opaque) {
  const im = await Jimp.read(source);
  const { width, height, data } = im.bitmap;
  return png(size, size, resample(data, width, height, size, size), opaque);
}

async function adaptive() {
  const im = await Jimp.read(brand('reduction-mark-1024.png'));
  const { width, height, data } = im.bitmap;
  const small = resample(data, width, height, ADAPTIVE_SCALE_PX, ADAPTIVE_SCALE_PX);
  const out = Buffer.alloc(1024 * 1024 * 4);
  const off = (1024 - ADAPTIVE_SCALE_PX) / 2;
  for (let y = 0; y < ADAPTIVE_SCALE_PX; y++)
    small.copy(out, ((y + off) * 1024 + off) * 4, y * ADAPTIVE_SCALE_PX * 4, (y + 1) * ADAPTIVE_SCALE_PX * 4);
  return png(1024, 1024, out, false);
}

const copy = (f) => async () => fs.readFileSync(f);

/** The splash's image: fully transparent, so the splash is the plain
 *  background color (the opening sequence starts on empty cream). Not the
 *  plugin's "no image" option: in expo-splash-screen 57 that path leaves
 *  the iOS launch screen on the SYSTEM background (white, or black in dark
 *  mode) with constraints naming a view it removed, and Android's theme
 *  naming a drawable it no longer writes. A transparent image keeps every
 *  generated file on the plugin's normal path. */
const blank = () => png(64, 64, Buffer.alloc(64 * 64 * 4), false);

const outputs = [
  // The phone (native: these ship in the binary, not over the air).
  [app('icon.png'), copy(brand('reduction-icon-1024.png')), 'iOS app icon'],
  [app('splash-blank.png'), blank, 'splash image (transparent: a plain splash)'],
  [app('adaptive-icon.png'), adaptive, 'Android adaptive icon foreground'],
  // Over the air: the sign-in screen's mark (BrandLogo), 128pt at 3x.
  [app('brand-mark.png'), () => resized(brand('reduction-mark-1024.png'), 384, false), 'in-app mark'],
  // The website (a Publish).
  [web('reduction-icon.svg'), copy(brand('reduction-icon.svg')), 'favicon (SVG)'],
  [web('reduction-mark.svg'), copy(brand('reduction-mark.svg')), 'nav mark'],
  [web('reduction-icon-32.png'), () => resized(brand('reduction-icon-1024.png'), 32, true), 'favicon, push badge'],
  [web('reduction-icon-180.png'), () => resized(brand('reduction-icon-1024.png'), 180, true), 'apple-touch-icon, push icon'],
  [web('reduction-icon-192.png'), () => resized(brand('reduction-icon-1024.png'), 192, true), 'manifest'],
  [web('reduction-icon-512.png'), () => resized(brand('reduction-icon-1024.png'), 512, true), 'manifest'],
];

let stale = 0;
for (const [file, make, what] of outputs) {
  const bytes = await make();
  const rel = path.relative(root, file);
  const same = fs.existsSync(file) && fs.readFileSync(file).equals(bytes);
  if (check) {
    if (!same) stale++;
    console.log(`${same ? 'ok     ' : 'STALE  '} ${rel}  (${what})`);
  } else {
    fs.writeFileSync(file, bytes);
    console.log(`${same ? 'same   ' : 'wrote  '} ${rel}  (${what}, ${bytes.length} B)`);
  }
}
if (check && stale) {
  console.error(`brand-icons: ${stale} file(s) differ from brand/ — run node scripts/brand-icons.mjs`);
  process.exit(1);
}
