/**
 * lib/timerAlerts.ts — timer alerts the phone schedules for itself. The
 * decisions are lib/timerAlertPolicy.ts (pure, tested); this file asks the
 * OS and nothing else.
 *
 * NO NATIVE CHANGE: scheduling a local notification is the same
 * expo-notifications module every shipped binary already carries for the
 * push token, so this reaches phones as an over-the-air update.
 *
 * THE PUSH TOKEN IS HANDED BACK. A phone that turned timers on under the
 * old bundle gave the server a push token, and the server would go on
 * pushing beside the alert scheduled here — two buzzes per timer whenever
 * the server happened to be awake. `retireServerPush` unsubscribes that
 * token once; until it succeeds (offline, say) it is retried on the next
 * launch, and the doubled alert is the only cost of the wait.
 *
 * NOT VERIFIABLE FROM A CONTAINER: what is proven here is the plan and the
 * reconcile (timerAlertPolicy.test.ts), not that a locked phone rings.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { disablePush } from './push';
import {
  deriveAlertState,
  plannedAlerts,
  reconcileAlerts,
  type AlertFacts,
  type AlertState,
  type TimedEntry,
} from './timerAlertPolicy';

const CHOICE_KEY = 'reduction_timer_alerts';

async function storedChoice(): Promise<AlertFacts['choice']> {
  try {
    const v = await AsyncStorage.getItem(CHOICE_KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

async function permission(): Promise<AlertFacts['permission']> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return null;
  }
}

export async function timerAlertState(): Promise<AlertState> {
  if (Platform.OS === 'web') return 'unsupported';
  return deriveAlertState({ platform: Platform.OS, permission: await permission(), choice: await storedChoice() });
}

// The last library seen, so switching alerts on schedules the timers that
// are already running without waiting for the next library change.
let lastEntries: readonly TimedEntry[] = [];
// One reconcile at a time: two overlapping ones read the same pending list
// and could each cancel what the other just scheduled.
let chain: Promise<void> = Promise.resolve();

async function reconcile(entries: readonly TimedEntry[]): Promise<void> {
  const state = await timerAlertState();
  const plan = state === 'on' ? plannedAlerts(entries, Date.now()) : [];
  const pending = (await Notifications.getAllScheduledNotificationsAsync()).map((r) => ({
    identifier: r.identifier,
    data: r.content.data,
  }));
  const { cancel, schedule } = reconcileAlerts(plan, pending);
  for (const id of cancel) await Notifications.cancelScheduledNotificationAsync(id);
  for (const a of schedule) {
    await Notifications.scheduleNotificationAsync({
      identifier: a.identifier,
      content: { title: a.title, body: a.body, data: a.data, sound: 'default' },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: a.endsAt,
        ...(Platform.OS === 'android' ? { channelId: 'timers' } : {}),
      },
    });
  }
}

/** Make the device's pending alerts match the library. Called on every
 *  library change; never throws — a failed reconcile is retried by the
 *  next change, and the cook screen's own alert is unaffected. */
export function syncTimerAlerts(entries: readonly TimedEntry[]): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve();
  lastEntries = entries;
  chain = chain
    .then(() => reconcile(lastEntries))
    .catch((e) => console.warn('[timerAlerts] reconcile failed:', (e as Error).message));
  return chain;
}

/** Sign-out: nothing of the account's should ring on this phone. */
export function clearTimerAlerts(): Promise<void> {
  return syncTimerAlerts([]);
}

/** The permission request is the first thing this does, so the OS prompt
 *  follows the tap with nothing slow in between. */
export async function enableTimerAlerts(): Promise<AlertState> {
  if (Platform.OS === 'web') return 'unsupported';
  const asked = await Notifications.requestPermissionsAsync();
  if (!asked.granted) return asked.canAskAgain ? 'off' : 'denied';
  await AsyncStorage.setItem(CHOICE_KEY, 'on').catch(() => {});
  await syncTimerAlerts(lastEntries);
  return timerAlertState();
}

export async function disableTimerAlerts(): Promise<AlertState> {
  await AsyncStorage.setItem(CHOICE_KEY, 'off').catch(() => {});
  await syncTimerAlerts(lastEntries);
  return timerAlertState();
}

/** Hand back a push token the old bundle registered (see the header). */
export async function retireServerPush(userId: string): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await disablePush(userId);
  } catch (e) {
    console.warn('[timerAlerts] could not hand back the push token:', (e as Error).message);
  }
}

