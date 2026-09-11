import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * Falls back to the light palette when no dark key is defined in
 * constants/colors.ts. Memoised on the scheme, so the object's identity is
 * stable across renders — DiagramView's memoised cells depend on that: a
 * fresh object every render would make every cell re-render on every tap,
 * which is the Phase 0 finding the memoisation exists to fix.
 */
type Palette = typeof colors.light;
const palettes: Record<string, Palette> = colors as unknown as Record<string, Palette>;

export function useColors() {
  const scheme = useColorScheme();
  return useMemo(() => {
    const palette = scheme === 'dark' && palettes.dark ? palettes.dark : colors.light;
    return {
      ...palette,
      radius: colors.radius,
      radiusButton: colors.radiusButton,
      radiusCard: colors.radiusCard,
    };
  }, [scheme]);
}

export type Colors = ReturnType<typeof useColors>;
