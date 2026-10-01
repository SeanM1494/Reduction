/**
 * lib/crashReporter.ts — what the phone tells the server when it breaks
 * (Oct 1). Three ways in, one report shape (recipe-model `crashReport.ts`,
 * scrubbed before it leaves the phone):
 *
 *  - `render`: the root ErrorBoundary caught a render error and showed
 *    "Something went wrong". Nothing crashed, so Apple never hears of it;
 *    this is the case the reporter exists for.
 *  - `fatal` / `error`: an uncaught JS error reached React Native's global
 *    handler. A FATAL one closes the app as soon as the handler returns, so
 *    the report is written to storage first and sent at the next launch.
 *  - `emergency_launch`: expo-updates fell back to the embedded bundle
 *    because the downloaded update crashed on launch. The update itself is
 *    the bug, and this is the only place the phone can say so.
 *
 * What it cannot see: an error on the UI thread (a worklet) or in native
 * code closes the app without passing through JS at all. Those are Apple's
 * crash reports (Xcode Organizer), which is why both are needed.
 *
 * Off in development (`__DEV__`): the Replit workspace's dev server writes
 * to the production database, and a red box is already a report.
 *
 * Every native module is required lazily and every step is in a try: a
 * crash reporter that throws inside the global handler turns one crash into
 * a loop.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { crashReportFrom, type CrashKind, type CrashReport } from '@workspace/recipe-model/crashReport';
import { postCrashReport } from '@/lib/api';
import { PENDING_KEY, claimSend, enqueue, freshSendState, parseQueue } from '@/lib/crashQueue';

type UpdatesModule = {
  runtimeVersion?: string | null;
  updateId?: string | null;
  channel?: string | null;
  isEmbeddedLaunch?: boolean;
  isEmergencyLaunch?: boolean;
  emergencyLaunchReason?: string | null;
};
type DeviceModule = { osVersion?: string | null };
type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler(): GlobalHandler; setGlobalHandler(h: GlobalHandler): void };

/** How long a fatal error waits for its report to reach storage before the app closes. */
const FATAL_WRITE_MS = 800;

const state = freshSendState();
let route: string | null = null;
let installed = false;

function load<T>(name: 'expo-updates' | 'expo-device'): T | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (name === 'expo-updates' ? require('expo-updates') : require('expo-device')) as T;
  } catch {
    return null;
  }
}

const enabled = (): boolean => !__DEV__ && Platform.OS !== 'web';

/** The screen being shown, as a route PATTERN (`/recipe/[id]`), never a path. */
export function noteCrashRoute(pattern: string): void {
  route = pattern;
}

function build(kind: CrashKind, error: unknown, componentStack?: string): CrashReport {
  const updates = load<UpdatesModule>('expo-updates');
  const device = load<DeviceModule>('expo-device');
  return crashReportFrom(
    kind,
    error,
    {
      platform: Platform.OS === 'android' ? 'android' : 'ios',
      route,
      appVersion: Constants.expoConfig?.version || null,
      runtime: updates?.runtimeVersion || null,
      updateId: updates && !updates.isEmbeddedLaunch ? updates.updateId || null : null,
      channel: updates?.channel || null,
      osVersion: device?.osVersion ?? (Platform.Version != null ? String(Platform.Version) : null),
    },
    componentStack
  );
}

function send(report: CrashReport): void {
  if (!claimSend(state, report)) return;
  void postCrashReport(report);
}

/** For the root ErrorBoundary's `onError`. */
export function reportRenderError(error: Error, componentStack: string): void {
  try {
    if (enabled()) send(build('render', error, componentStack));
  } catch {
    // Never a second error.
  }
}

async function persist(report: CrashReport): Promise<void> {
  const queue = parseQueue(await AsyncStorage.getItem(PENDING_KEY));
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(enqueue(queue, report)));
}

/** Sends what a fatal error left last time. Cleared first, so a report that
 *  itself crashes the sender is never retried for ever. */
async function flushPending(): Promise<void> {
  const queue = parseQueue(await AsyncStorage.getItem(PENDING_KEY));
  if (!queue.length) return;
  await AsyncStorage.removeItem(PENDING_KEY);
  for (const r of queue) await postCrashReport(r);
}

/** Once, at boot, from the root layout's module scope. */
export function installCrashReporter(): void {
  if (installed || !enabled()) return;
  installed = true;
  try {
    const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (eu) {
      const previous = eu.getGlobalHandler();
      eu.setGlobalHandler((error, isFatal) => {
        let report: CrashReport | null = null;
        try {
          report = build(isFatal ? 'fatal' : 'error', error);
        } catch {
          report = null;
        }
        if (!report || !isFatal) {
          if (report) send(report);
          previous(error, isFatal);
          return;
        }
        // Fatal: storage, then React Native closes the app; the report goes
        // at the next launch. Not sent now as well — a send that landed
        // would be sent again from storage, and the counts would lie.
        Promise.race([persist(report).catch(() => undefined), new Promise((ok) => setTimeout(ok, FATAL_WRITE_MS))]).finally(() =>
          previous(error, isFatal)
        );
      });
    }
  } catch {
    // No handler installed; Apple's reports still see a fatal crash.
  }
  void flushPending().catch(() => undefined);
  try {
    const updates = load<UpdatesModule>('expo-updates');
    if (updates?.isEmergencyLaunch) {
      send(build('emergency_launch', { name: 'EmergencyLaunch', message: updates.emergencyLaunchReason ?? 'no reason given' }));
    }
  } catch {
    // Nothing to report.
  }
}
