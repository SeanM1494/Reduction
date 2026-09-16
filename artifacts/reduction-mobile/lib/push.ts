/**
 * lib/push.ts — timer notifications on a phone: the Expo push token.
 *
 * THE SERVER SIDE EXISTS (api-server/src/lib/push.ts, the Expo arm): a
 * token goes in the same table as a web push endpoint, and a due timer is
 * relayed through Expo's push service with the whole TimerPayload in
 * `data`. This file is the client half the ROADMAP names: ask the OS, get
 * the token, hand it to POST /api/push/subscribe, remember that we did,
 * and take a tapped notification to its recipe.
 *
 * WHAT IS REMEMBERED, AND WHY LOCALLY. "On" means "this device gave the
 * server a token", and the server has no per-device read for that (the
 * table is keyed by endpoint, and the app would have to hold the token to
 * ask). So the token is kept in AsyncStorage next to the account it was
 * registered for; disabling deletes that exact endpoint, and signing in as
 * someone else does not inherit the previous account's subscription.
 *
 * THE DECISIONS ARE NOT HERE. What the card shows for a given host is
 * lib/pushPolicy.ts (pure, tested); this file only gathers the facts.
 *
 * NOT VERIFIABLE FROM A CONTAINER, stated up front: a token needs a
 * physical device and a build with an EAS project id, so what is proven
 * here is the state machine and the request shapes against the route's
 * own checks — not that a phone buzzes.
 */

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { subscribePush, unsubscribePush } from './api';
import { derivePushState, isExpoPushToken, type PushFacts, type PushState } from './pushPolicy';

const TOKEN_KEY = 'reduction_push_token';

/** The EAS project id the build carries — what Expo's push service keys a
 *  token to. Absent in a bare development build, which is a build problem
 *  the card names rather than a toggle that fails. */
function projectId(): string | null {
  const fromEas = Constants.easConfig?.projectId;
  const fromExtra = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return (fromEas || fromExtra || null) as string | null;
}

/**
 * How a notification presents while the app is in the foreground — the
 * case that matters most, since that is when someone is cooking. Without
 * a handler the OS shows nothing for a foreground app, and a timer that
 * finishes while you are looking at the recipe would be silent.
 */
export function configureNotifications(): void {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    // Android needs a channel for sound and importance; iOS has no such
    // thing. One channel, because there is one kind of notification.
    Notifications.setNotificationChannelAsync('timers', {
      name: 'Timers',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
    }).catch(() => {});
  }
}

async function storedToken(userId: string): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { userId?: string; token?: string };
    return parsed.userId === userId && parsed.token ? parsed.token : null;
  } catch {
    return null;
  }
}

async function permission(): Promise<PushFacts['permission']> {
  try {
    const p = await Notifications.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return null;
  }
}

async function facts(userId: string): Promise<PushFacts> {
  const web = Platform.OS === 'web';
  return {
    platform: Platform.OS,
    isDevice: web ? false : Device.isDevice,
    projectId: web ? null : projectId(),
    permission: web ? null : await permission(),
    storedToken: web ? null : await storedToken(userId),
  };
}

export async function pushState(userId: string): Promise<PushState> {
  return derivePushState(await facts(userId));
}

/**
 * The permission request is the first thing this does, with nothing
 * awaited before it that could take long: the OS prompt should follow the
 * tap immediately.
 */
export async function enablePush(userId: string): Promise<PushState> {
  const before = await facts(userId);
  const state = derivePushState(before);
  if (state !== 'off') return state;
  const asked = await Notifications.requestPermissionsAsync();
  if (!asked.granted) return asked.canAskAgain ? 'off' : 'denied';
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: before.projectId! });
  if (!isExpoPushToken(token)) throw new Error('Could not get a push token for this device.');
  await subscribePush(token, `${Platform.OS} ${Device.modelName ?? ''} ${Constants.expoConfig?.version ?? ''}`.trim());
  await AsyncStorage.setItem(TOKEN_KEY, JSON.stringify({ userId, token })).catch(() => {});
  return 'on';
}

export async function disablePush(userId: string): Promise<PushState> {
  const token = await storedToken(userId);
  if (token) {
    await unsubscribePush(token);
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => {});
  }
  return pushState(userId);
}

/**
 * A tapped notification, whether it arrived while the app was running or
 * launched it. Returns the unsubscribe. The listener fires for taps while
 * running; the last response covers a cold launch from a notification,
 * which the listener registered after launch would otherwise miss.
 */
export function onNotificationTap(handle: (data: unknown) => void): () => void {
  if (Platform.OS === 'web') return () => {};
  const sub = Notifications.addNotificationResponseReceivedListener((r) => {
    handle(r.notification.request.content.data);
  });
  Notifications.getLastNotificationResponseAsync()
    .then((r) => {
      if (r) handle(r.notification.request.content.data);
    })
    .catch(() => {});
  return () => sub.remove();
}
