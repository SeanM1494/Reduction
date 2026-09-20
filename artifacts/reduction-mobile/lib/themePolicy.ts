/**
 * lib/themePolicy.ts — which palette the app draws with, from a preference
 * and the system.
 *
 * PURE: no react-native, no `@/` alias, so `themePolicy.test.ts` runs under
 * plain node. The web's rule (hooks/useTheme.ts), with one addition: an
 * explicit "system" mode. On the web an unmade choice tracks the system
 * preference live and the toggle shows three modes; here the unmade choice
 * is a fourth, visible option, so someone who picked Dark once can hand the
 * decision back to the phone. Colorblind mode layers a blue/orange pair
 * over the warm/cool "ready vs. done" accents on top of whichever base is
 * active, rather than fixing one base.
 */

export type ThemeMode = 'system' | 'light' | 'dark' | 'colorblind';
export type ThemeBase = 'light' | 'dark';

export const THEME_MODES: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: 'system', label: 'System' },
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'colorblind', label: 'Colorblind' },
];

/** What is stored, back to a mode; anything else is the default. */
export function parseThemeMode(raw: unknown): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'colorblind' ? raw : 'system';
}

export function resolveTheme(mode: ThemeMode, system: ThemeBase | null | undefined): { base: ThemeBase; colorblind: boolean } {
  const base: ThemeBase = mode === 'dark' ? 'dark' : mode === 'light' ? 'light' : system === 'dark' ? 'dark' : 'light';
  return { base, colorblind: mode === 'colorblind' };
}
