/**
 * components/settings/loadUpdates.ts — expo-updates, required lazily and
 * once, for the screens that show or switch the update channel. A module
 * that fails to load is null, never a crash (the same reasoning as
 * FeedbackRow's facts).
 */

import { Platform } from 'react-native';

export type UpdatesModule = {
  isEnabled: boolean;
  channel: string | null;
  setUpdateRequestHeadersOverride: (headers: Record<string, string> | null) => void;
  checkForUpdateAsync: () => Promise<{ isAvailable: boolean; isRollBackToEmbedded?: boolean }>;
  fetchUpdateAsync: () => Promise<{ isNew: boolean; isRollBackToEmbedded?: boolean }>;
  reloadAsync: () => Promise<void>;
};

let cached: UpdatesModule | null | undefined;

export function loadUpdates(): UpdatesModule | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-updates') as UpdatesModule;
    cached = typeof mod.setUpdateRequestHeadersOverride === 'function' ? mod : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Updates can be switched only in a release build with expo-updates on —
 *  never on the web, where the module is a stub that claims to be enabled. */
export const updatesUsable = (m: UpdatesModule | null): m is UpdatesModule => !!m && m.isEnabled && Platform.OS !== 'web';
