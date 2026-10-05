/**
 * lib/ratingPrompt.ts — Apple's own rating prompt, asked as a recipe screen
 * is left after a finished cook (lib/rating.ts has the rules and why).
 *
 * expo-store-review reaches for its native module at IMPORT
 * (`requireNativeModule('ExpoStoreReview')`), and it arrived in 1.3.0. An
 * over-the-air update only reaches binaries of the same runtime version,
 * so an older app should never run this file — this is the second fence,
 * the same as components/browser/loadPageView.ts: ask whether the module
 * is there, and only then require the package. No module, no prompt, no
 * crash. Every failure is swallowed: a rating is never worth an error.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { afterAsking, afterFinishedCook, parseRating, shouldAsk, type RatingState } from './rating';

const KEY = 'reduction.rating.v1';

type StoreReview = { isAvailableAsync(): Promise<boolean>; requestReview(): Promise<void> };

function loadStoreReview(): StoreReview | null {
  if (Platform.OS !== 'ios') return null;
  try {
    if (!requireOptionalNativeModule('ExpoStoreReview')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-store-review') as StoreReview;
  } catch {
    return null;
  }
}

async function read(): Promise<RatingState> {
  try {
    return parseRating(await AsyncStorage.getItem(KEY));
  } catch {
    return parseRating(null);
  }
}

async function write(s: RatingState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not stored: at worst the next finish counts from an older number.
  }
}

/** A cook just finished (every step ticked). */
export async function noteFinishedCook(): Promise<void> {
  await write(afterFinishedCook(await read()));
}

/** The recipe screen is being left; ask if the rules say so. */
export async function maybeAskForRating(finishedThisVisit: boolean): Promise<void> {
  if (!finishedThisVisit) return;
  const store = loadStoreReview();
  if (!store) return;
  const version = Constants.expoConfig?.version ?? null;
  const state = await read();
  if (!version || !shouldAsk(state, version, finishedThisVisit)) return;
  try {
    if (!(await store.isAvailableAsync())) return;
    // Recorded before asking: Apple says nothing about whether it showed
    // anything, and a second request in the same version would only spend
    // the year's three on the same person.
    await write(afterAsking(state, version));
    await store.requestReview();
  } catch {
    // Nothing to tell anyone.
  }
}
