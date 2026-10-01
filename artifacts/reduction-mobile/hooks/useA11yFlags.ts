/**
 * hooks/useA11yFlags.ts — Reduce Motion and the screen reader, kept current.
 *
 * Read once at mount and then followed, so turning either on while the app
 * is open takes effect at once. The web has no screen-reader signal —
 * RN-web's `isScreenReaderEnabled` resolves TRUE unconditionally, which made
 * "Watch instead" wait for Next in every browser — so on the web it is not
 * asked, and a browser only ever reports Reduce Motion
 * (`prefers-reduced-motion`).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

export function useA11yFlags(): { reduceMotion: boolean; screenReader: boolean } {
  const [reduceMotion, setReduceMotion] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => live && setReduceMotion(v))
      .catch(() => {});
    if (Platform.OS !== 'web')
      AccessibilityInfo.isScreenReaderEnabled()
        .then((v) => live && setScreenReader(v))
        .catch(() => {});
    const a = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const b = Platform.OS === 'web' ? null : AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      live = false;
      a?.remove();
      b?.remove();
    };
  }, []);
  return { reduceMotion, screenReader };
}
