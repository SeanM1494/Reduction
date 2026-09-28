/**
 * components/browser/loadPageView.ts — the Browse tab's way to the page
 * view, and the reason a phone without the in-app browser never crashes.
 *
 * react-native-webview reaches for its native module with
 * `TurboModuleRegistry.getEnforcing('RNCWebViewModule')` at IMPORT, so on
 * a binary built before it was added (anything older than 1.1.0) a plain
 * `import` would throw as the Find tab loaded. Over-the-air updates only
 * reach binaries of the same runtime version (app.json: the policy is the
 * app version), so an older app should never receive this code at all —
 * this is the second fence, for the day that assumption is wrong. It asks
 * whether the native module is there first, and only then requires the
 * view, lazily; no module means Browse says "needs the latest version".
 *
 * The web preview has no native module and needs none: its PageView is an
 * iframe (PageView.web.tsx), which the same require resolves to.
 */

import type React from 'react';
import { Platform, TurboModuleRegistry } from 'react-native';
import type { PageViewHandle, PageViewProps } from './types';

type PageViewComponent = React.ForwardRefExoticComponent<PageViewProps & React.RefAttributes<PageViewHandle>>;

let loaded: PageViewComponent | null | undefined;

export function loadPageView(): PageViewComponent | null {
  if (loaded !== undefined) return loaded;
  try {
    if (Platform.OS !== 'web' && !TurboModuleRegistry.get('RNCWebViewModule')) {
      loaded = null;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = (require('./PageView') as { PageView: PageViewComponent }).PageView;
    }
  } catch {
    loaded = null;
  }
  return loaded;
}
