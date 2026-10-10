/**
 * lib/themeTokens.test.ts — every token the light palette has, the dark one
 * has too (Oct 1). `useColors` casts the palettes to one type, so TypeScript
 * would let a token added to light alone through, and every component that
 * reads it would get `undefined` in dark mode — a colorless surface, or a
 * crash where a value is used as a string. Checked when Cocoa added five
 * tokens; kept so the next one cannot slip.
 *
 * And the paper's text (Oct 1): the grays on the Recipe Box pages and the
 * reel's cards were literals until they became `paperMuted`, `paperFaint`
 * and `paperPill`. Light must render exactly as before — its values ARE the
 * old literals — and dark's small text must clear 4.5:1 on dark paper.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import colors from '../constants/colors';

const isColour = (v: unknown) => typeof v === 'string' && /^(#[0-9a-f]{6}|rgba\(\d+,\s?\d+,\s?\d+,\s?(0|1|0?\.\d+)\))$/i.test(v);

test('light and dark carry the same tokens, every one a real color', () => {
  assert.deepEqual(Object.keys(colors.dark).sort(), Object.keys(colors.light).sort());
  for (const scheme of ['light', 'dark'] as const) {
    for (const [k, v] of Object.entries(colors[scheme])) assert.ok(isColour(v), `${scheme}.${k} = ${String(v)}`);
  }
});

test('the colorblind layers only override tokens the base palettes have', () => {
  for (const layer of [colors.colorblindLight, colors.colorblindDark]) {
    for (const k of Object.keys(layer)) assert.ok(k in colors.light, `colorblind token ${k} has no base`);
  }
});

/** WCAG relative luminance and contrast ratio, for #rrggbb. */
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('light paper text is exactly the literals it replaced, so light mode renders unchanged', () => {
  assert.equal(colors.light.paper, '#fbf6ea');
  assert.equal(colors.light.paperSpine, '#f4ecdb');
  // PageFace's MUTED (time, serves; StarterReel's SITE_INK), FAINT ("+N
  // more", the page number, the blank page) and pillNever's background.
  assert.equal(colors.light.paperMuted, '#8a7a66');
  assert.equal(colors.light.paperFaint, '#a8977f');
  assert.equal(colors.light.paperPill, '#ece3d0');
});

test('dark paper text is at least 4.5:1 on the dark paper, and the pill text on the pill', () => {
  const { paper, paperMuted, paperFaint, paperPill } = colors.dark;
  assert.equal(paper, '#ebdfc6');
  for (const [name, ink] of [['paperMuted', paperMuted], ['paperFaint', paperFaint]] as const) {
    assert.ok(contrast(ink, paper) >= 4.5, `${name} ${ink} on ${paper}: ${contrast(ink, paper).toFixed(2)}:1`);
  }
  // "Not cooked yet": paperMuted on its own background.
  assert.ok(contrast(paperMuted, paperPill) >= 4.5, `pill ${paperMuted} on ${paperPill}: ${contrast(paperMuted, paperPill).toFixed(2)}:1`);
  // And no darker than it needs to be: still secondary text, well short of
  // the ingredient line's ink (#5c4d3c, 6.2:1).
  assert.ok(contrast(paperMuted, paper) < 5, `paperMuted is darker than it needs to be: ${contrast(paperMuted, paper).toFixed(2)}:1`);
});
