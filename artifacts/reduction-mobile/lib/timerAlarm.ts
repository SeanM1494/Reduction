/**
 * lib/timerAlarm.ts — the ONLY file that touches the app's AlarmKit module
 * (modules/timer-alarm). Everything else asks this file.
 *
 * OPTIONAL BY CONSTRUCTION. The module exists only in binaries built from
 * 1.3.0 on, and AlarmKit only on iOS 26+. `requireOptionalNativeModule`
 * answers null on an older binary instead of throwing at import (the
 * react-native-webview lesson, CLAUDE.md), and the module's own
 * `isAvailable` answers false below iOS 26 — both read as "unavailable",
 * and timers keep ringing as notifications.
 */

import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import type { AlarmAuth, ScheduledAlarm } from './timerAlertPolicy';

interface TimerAlarmNative {
  isAvailable(): boolean;
  authorizationState(): Promise<string>;
  requestAuthorization(): Promise<string>;
  list(): Promise<ScheduledAlarm[]>;
  schedule(id: string, fireAt: number, title: string, stopLabel: string, tint: string): Promise<void>;
  cancel(id: string): Promise<void>;
}

const native: TimerAlarmNative | null =
  Platform.OS === 'ios' ? requireOptionalNativeModule<TimerAlarmNative>('TimerAlarm') : null;

function usable(): TimerAlarmNative | null {
  try {
    return native && native.isAvailable() ? native : null;
  } catch {
    return null;
  }
}

const asAuth = (s: string): AlarmAuth =>
  s === 'authorized' || s === 'denied' || s === 'notDetermined' ? s : 'unavailable';

export async function alarmAuth(): Promise<AlarmAuth> {
  const m = usable();
  if (!m) return 'unavailable';
  try {
    return asAuth(await m.authorizationState());
  } catch {
    return 'unavailable';
  }
}

/** Shows the system prompt (NSAlarmKitUsageDescription) the first time. */
export async function requestAlarmAuth(): Promise<AlarmAuth> {
  const m = usable();
  if (!m) return 'unavailable';
  return asAuth(await m.requestAuthorization());
}

export async function listAlarms(): Promise<ScheduledAlarm[]> {
  const m = usable();
  return m ? m.list() : [];
}

/** The terracotta of "ready to cook" (constants/colors.ts warmLine). */
const TINT = '#b93326';

export async function scheduleAlarm(id: string, fireAt: number, title: string): Promise<void> {
  const m = usable();
  if (!m) throw new Error('Alarms are not available on this phone.');
  await m.schedule(id, fireAt, title, 'Done', TINT);
}

export async function cancelAlarm(id: string): Promise<void> {
  const m = usable();
  if (m) await m.cancel(id);
}
