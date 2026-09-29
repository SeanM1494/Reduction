/**
 * lib/opening/launch.ts — the device side of the opening sequence: what
 * this launch is, the two stored stamps, and whether the app underneath is
 * ready to be revealed. The rules themselves are pure (cadence.ts,
 * destination.ts); this file only gathers their inputs.
 *
 * A COLD START IS A NEW JS PROCESS. Everything here is module state, made
 * once per process: `launchInfo()` is decided once and cached, so a return
 * from the background — the same process — can never decide it again, and
 * never plays the intro or re-lands anywhere.
 *
 * Nothing is decided in the background. iOS can start the process before
 * anyone opens the app (a background fetch, a notification's work); the
 * decision waits for the app to be ACTIVE, and the stamps are written only
 * once the sequence is on screen and its clock has started.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, AppState, Appearance, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import { LAND_ON_RECIPE_BOX, OPENING_ENABLED } from './config';
import { chooseOpening, stampFor, type Decision, type LaunchSource, type Stamps, type Version } from './cadence';
import { isAppLink, launchLanding } from './destination';
import type { FrameStats } from './scene';

const FULL_KEY = 'reduction_opening_full_shown';
const LAST_KEY = 'reduction_opening_last_shown';
/** Everything the decision reads is local and quick; if it is not, the
 *  launch goes straight to the app rather than wait. */
const DECIDE_CAP_MS = 400;
const SCHEME = (Constants.expoConfig?.scheme as string | undefined) ?? 'reduction-mobile';

// ——— the stamps ———

export async function readStamps(): Promise<Stamps> {
  try {
    const [full, last] = await Promise.all([AsyncStorage.getItem(FULL_KEY), AsyncStorage.getItem(LAST_KEY)]);
    const n = last === null ? null : Number(last);
    return { fullShown: full === '1', lastShownAt: n !== null && Number.isFinite(n) ? n : null };
  } catch {
    // Unreadable storage must not replay the Full intro on every launch.
    return { fullShown: true, lastShownAt: Date.now() };
  }
}

async function writeStamps(s: Stamps) {
  await Promise.all([
    AsyncStorage.setItem(FULL_KEY, s.fullShown ? '1' : '0'),
    s.lastShownAt === null ? AsyncStorage.removeItem(LAST_KEY) : AsyncStorage.setItem(LAST_KEY, String(s.lastShownAt)),
  ]).catch(() => {});
}

/** The sequence is on screen and running: count it as shown. */
export async function markShown(version: Version) {
  await writeStamps(stampFor(version, Date.now(), await readStamps()));
}

/** The testing sheet's resets. */
export async function resetStamps(which: 'full' | 'last') {
  await AsyncStorage.removeItem(which === 'full' ? FULL_KEY : LAST_KEY).catch(() => {});
}

// ——— what this launch is ———

function whenActive(): Promise<void> {
  return new Promise((resolve) => {
    if (AppState.currentState === 'active') return resolve();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        sub.remove();
        resolve();
      }
    });
  });
}

async function launchSource(): Promise<LaunchSource> {
  if (Platform.OS === 'web') return 'normal';
  try {
    if (await Notifications.getLastNotificationResponseAsync()) return 'notification';
  } catch {
    // No notifications module answer: not a notification launch.
  }
  try {
    if (isAppLink(await Linking.getInitialURL(), SCHEME)) return 'link';
  } catch {
    // No initial URL answer: not a link launch.
  }
  return 'normal';
}

function capped<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export interface LaunchInfo {
  decision: Decision;
  /** 'normal' only when every check answered in time and none found a
   *  notification or a link; null when they did not answer in time. */
  source: LaunchSource | null;
  /** The system is in dark mode, so the native splash was #131110. */
  darkStart: boolean;
}

let launch: Promise<LaunchInfo> | null = null;

const skipped = (reason: string, darkStart: boolean): LaunchInfo => ({
  decision: { play: 'none', version: null, reason },
  source: null,
  darkStart,
});

/** Decided once per process, when the app first becomes active. */
export function launchInfo(): Promise<LaunchInfo> {
  if (!launch) {
    launch = (async (): Promise<LaunchInfo> => {
      await whenActive();
      const facts = await capped(
        Promise.all([
          readStamps(),
          launchSource(),
          // react-native-web answers true unconditionally (it cannot know);
          // the web build exists for checking the app, so it plays there.
          Platform.OS === 'web' ? Promise.resolve(false) : AccessibilityInfo.isScreenReaderEnabled().catch(() => false),
          AccessibilityInfo.isReduceMotionEnabled().catch(() => false),
        ]),
        DECIDE_CAP_MS
      );
      const darkStart = Appearance.getColorScheme() === 'dark';
      if (!facts) return skipped('launch checks too slow', darkStart);
      const [stamps, source, screenReader, reduceMotion] = facts;
      const decision = chooseOpening({
        enabled: OPENING_ENABLED,
        now: Date.now(),
        ...stamps,
        coldStart: true,
        active: true,
        source,
        screenReader,
        reduceMotion,
      });
      return { decision, source, darkStart };
    })().catch(() => skipped('launch checks failed', false));
  }
  return launch as Promise<LaunchInfo>;
}

// ——— where a cold start lands ———

let bootSignedIn: boolean | null = null;
let landingTaken = false;

/** The Gate's FIRST answer to "signed in?" in this process. A sign-in
 *  later in the session is not a cold start and lands nowhere new. */
export function noteAuthSettled(signedIn: boolean) {
  if (bootSignedIn === null) bootSignedIn = signedIn;
}

/** Whether a landing may still be applied (so the signed-in tree can cover
 *  its first frame rather than flash Find). */
export function bootLandingPending() {
  return bootSignedIn === true && !landingTaken && LAND_ON_RECIPE_BOX;
}

/** Once per process: should the signed-in tree move to the Recipe Box? */
export async function takeBootLanding(): Promise<boolean> {
  if (!bootLandingPending()) return false;
  landingTaken = true;
  const info = await launchInfo();
  if (info.source === null) return false; // unsure what launched it: stay
  return launchLanding({ enabled: LAND_ON_RECIPE_BOX, signedIn: true, coldStart: true, source: info.source }) === 'recipe-box';
}

// ——— the app underneath ———

let appReady = false;
const readyListeners = new Set<() => void>();

/** The screen the launch lands on has something true to show. */
export function markAppReady() {
  if (appReady) return;
  appReady = true;
  readyListeners.forEach((l) => l());
}

export function onAppReady(l: () => void): () => void {
  if (appReady) {
    l();
    return () => {};
  }
  readyListeners.add(l);
  return () => readyListeners.delete(l);
}

// ——— replays and the testing sheet ———

export type ReplayKind = 'full' | 'quick' | 'static';
type ReplayListener = (kind: ReplayKind) => void;
const replayListeners = new Set<ReplayListener>();

/** Settings' "Replay intro" and the testing sheet. Touches no stamps. */
export function requestReplay(kind: ReplayKind) {
  replayListeners.forEach((l) => l(kind));
}

export function onReplay(l: ReplayListener): () => void {
  replayListeners.add(l);
  return () => replayListeners.delete(l);
}

let lastRun: (FrameStats & { kind: ReplayKind; at: number }) | null = null;
export function recordRun(stats: FrameStats, kind: ReplayKind) {
  lastRun = { ...stats, kind, at: Date.now() };
}
export function lastRunStats() {
  return lastRun;
}
