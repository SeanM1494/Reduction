/**
 * app/+native-intent.tsx — the share extension's link is not a route.
 *
 * The extension opens `reduction-mobile://dataUrl=…` (lib/sharedPage.ts),
 * which the router would otherwise try to open as a screen and show "not
 * found". On a cold start the app opens at the root, and on a warm one it
 * stays where it is; either way ShareReceiver reads the share and the
 * signed-in tree opens Find. Every other link passes through untouched —
 * the sign-in return above all.
 */
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  try {
    if (path.includes('dataUrl=')) return initial ? '/' : null;
  } catch {
    // Never throw here: a throw in this hook can take the app down.
  }
  return path;
}
