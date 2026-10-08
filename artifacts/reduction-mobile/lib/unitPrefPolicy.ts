/**
 * lib/unitPrefPolicy.ts — "Measurements" in Settings, and the menu flip.
 * Pure, so the runner can test it; lib/unitPref.ts holds the store.
 *
 * The setting is per device. The flip is the recipe menu's "Show in grams /
 * ounces": it overrides the setting for the rest of the app session, in
 * memory only, so a cook who flips mid-recipe is not surprised by it next
 * week. A flip never writes the setting.
 */

import type { UnitPref } from '../shared/amounts';
import type { Recipe } from '@/shared/layout';
import { withUnitPref, hasAltUnit } from '../shared/amounts';

export const UNIT_PREF_KEY = 'reduction_unit_pref';

export const UNIT_PREFS: ReadonlyArray<{ pref: UnitPref; label: string }> = [
  { pref: 'written', label: 'As written' },
  { pref: 'g', label: 'Grams' },
  { pref: 'oz', label: 'Ounces' },
];

export function parseUnitPref(raw: unknown): UnitPref {
  return raw === 'g' || raw === 'oz' ? raw : 'written';
}

/** The flip, if one was made this session, else the setting. */
export function effectiveUnitPref(setting: UnitPref, flip: UnitPref | null): UnitPref {
  return flip ?? setting;
}

/**
 * What the menu flip should switch to. Grams and ounces swap. From "as
 * written" it goes to the OTHER system than the one the recipe leads with,
 * judged by the first ingredient that has a second unit.
 */
export function flipTarget(recipe: Recipe, current: UnitPref): 'g' | 'oz' {
  if (current === 'g') return 'oz';
  if (current === 'oz') return 'g';
  for (const s of recipe.sections)
    for (const ing of s.ingredients) {
      if (!hasAltUnit(ing)) continue;
      return withUnitPref(ing, 'g') !== ing ? 'g' : 'oz';
    }
  return 'g';
}

/** The menu line, naming what a tap will show. */
export function flipLabel(target: 'g' | 'oz'): string {
  return target === 'g' ? 'Show in grams' : 'Show in ounces';
}
