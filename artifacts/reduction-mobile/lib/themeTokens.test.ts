/**
 * lib/themeTokens.test.ts — every token the light palette has, the dark one
 * has too (Oct 1). `useColors` casts the palettes to one type, so TypeScript
 * would let a token added to light alone through, and every component that
 * reads it would get `undefined` in dark mode — a colourless surface, or a
 * crash where a value is used as a string. Checked when Cocoa added five
 * tokens; kept so the next one cannot slip.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import colors from '../constants/colors';

const isColour = (v: unknown) => typeof v === 'string' && /^(#[0-9a-f]{6}|rgba\(\d+,\s?\d+,\s?\d+,\s?(0|1|0?\.\d+)\))$/i.test(v);

test('light and dark carry the same tokens, every one a real colour', () => {
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
