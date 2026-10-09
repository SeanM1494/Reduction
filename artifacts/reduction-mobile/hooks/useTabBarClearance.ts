import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Height of the classic tab bar's footprint beyond the home indicator; web pins it at 84. */
const CLASSIC_TAB_BAR = 84;

/**
 * How far a tab screen's content must stay clear of the bottom edge.
 *
 * The two tab layouts ((tabs)/_layout.tsx) differ here. ClassicTabLayout's
 * bar is absolutely positioned and reports nothing, so the screen adds the bar
 * itself on top of the home-indicator inset. NativeTabs (iOS 26) already folds
 * the floating bar into the safe-area bottom inset, so adding 84 again left
 * ~85pt of empty space between the content and the bar (Oct 9, a real
 * iPhone, invisible in Chromium, which only ever takes the classic path).
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return isLiquidGlassAvailable() ? insets.bottom : CLASSIC_TAB_BAR + insets.bottom;
}
