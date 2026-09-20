import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';
import { useThemeState } from '@/lib/theme-context';

/**
 * Returns the design tokens for the active appearance.
 *
 * The base palette (light or dark) and the colorblind layer come from the
 * theme preference (lib/theme-context.tsx: the stored choice resolved
 * against the phone); with no provider mounted the phone's scheme decides
 * on its own, as it always did. Colorblind mode swaps the warm/cool
 * "ready vs. done" accents for a blue/orange pair the web defines under
 * [data-colorblind="true"], on top of whichever base is active, and sets
 * `colorblind` so the diagram can add its non-colour ready cue.
 *
 * Memoised on (base, colorblind), so the object's identity is stable
 * across renders — DiagramView's memoised cells depend on that: a fresh
 * object every render would make every cell re-render on every tap, which
 * is the Phase 0 finding the memoisation exists to fix.
 */
type Palette = typeof colors.light;
const palettes: Record<string, Palette> = colors as unknown as Record<string, Palette>;

export function useColors() {
  const phone = useColorScheme();
  const theme = useThemeState();
  const base = theme ? theme.base : phone === 'dark' ? 'dark' : 'light';
  const colorblind = theme?.colorblind ?? false;
  return useMemo(() => {
    const palette = base === 'dark' && palettes.dark ? palettes.dark : colors.light;
    const layer = colorblind ? (base === 'dark' ? colors.colorblindDark : colors.colorblindLight) : null;
    return {
      ...palette,
      ...(layer ?? {}),
      scheme: base,
      colorblind,
      radius: colors.radius,
      radiusButton: colors.radiusButton,
      radiusCard: colors.radiusCard,
    };
  }, [base, colorblind]);
}

export type Colors = ReturnType<typeof useColors>;
