/**
 * components/ShareReceiver.tsx — takes what the Share sheet handed the app
 * and leaves it in lib/sharedPage.ts's store for Find to read.
 *
 * Mounted at the root, OUTSIDE the auth gate, so a share that arrives
 * signed out is held through sign-in rather than lost. iOS only: the
 * extension exists only there (app.json disables the package's Android
 * half), and the package's own default turns it off on the web.
 *
 * Two of the package's defaults are changed on purpose. `resetOnBackground`
 * is off because Sign in with Apple's sheet sends the app to the background,
 * and the default would throw the share away exactly when a signed-out
 * person goes to sign in; instead the share is copied into the store and
 * cleared from the App Group at once, so nothing can deliver it twice.
 *
 * The package's native module is loaded with requireOptionalNativeModule,
 * so on a binary built before 1.2.0 (no extension, no module) this does
 * nothing rather than throwing at import (CLAUDE.md, react-native-webview's
 * rule) — and the runtime version keeps such a binary from this bundle anyway.
 */
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { useShareIntent } from 'expo-share-intent';
import { offerShare, sharedItemFrom } from '@/lib/sharedPage';

export function ShareReceiver() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({
    resetOnBackground: false,
    disabled: Platform.OS !== 'ios',
  });
  useEffect(() => {
    if (!hasShareIntent) return;
    const item = sharedItemFrom(shareIntent);
    if (item) offerShare(item);
    resetShareIntent();
    // resetShareIntent is a fresh function each render; the share is what
    // this answers to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent, shareIntent]);
  return null;
}
