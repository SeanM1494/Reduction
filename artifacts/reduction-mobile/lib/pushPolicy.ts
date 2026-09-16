/**
 * lib/pushPolicy.ts — the decisions behind timer notifications, kept pure
 * so the runner can test them under plain node. lib/push.ts is the thin
 * layer that asks the OS and the server; nothing here imports either.
 *
 * WHAT A STATE MEANS (the web's PushState, with the install case replaced
 * by the two ways a native build can be unable to register):
 *
 *  - unsupported: this host can never hold a token — the web build, or a
 *    simulator (Apple issues push tokens to physical devices only).
 *  - needs-setup: a physical device, but the build has no EAS project id,
 *    which is what Expo's push service keys a token to. A build error, not
 *    a user's, and it is said so rather than shown as a toggle that fails.
 *  - denied: the OS said no and will not ask again; the only way back is
 *    the system Settings, so the card says that instead of offering a tap.
 *  - on: this device holds a token the server has been given.
 *  - off: it could, and has not.
 */

export type PushState = "unsupported" | "needs-setup" | "denied" | "on" | "off";

export interface PushFacts {
  /** react-native's Platform.OS. */
  platform: string;
  /** expo-device's isDevice: false on a simulator. */
  isDevice: boolean;
  /** The EAS project id the build carries, if any. */
  projectId: string | null;
  /** The OS permission: granted, denied (and cannot ask again), or
   *  undetermined. `null` when the OS could not be asked at all. */
  permission: "granted" | "denied" | "undetermined" | null;
  /** The token this device registered with the server, if it did. */
  storedToken: string | null;
}

export function derivePushState(f: PushFacts): PushState {
  if (f.platform === "web" || !f.isDevice) return "unsupported";
  if (!f.projectId) return "needs-setup";
  if (f.permission === "denied") return "denied";
  return f.storedToken ? "on" : "off";
}

/** Expo's token shape, mirrored from the server's own check so a token
 *  the server would refuse is never sent to it. */
const EXPO_TOKEN_RE = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
export const isExpoPushToken = (s: string): boolean => EXPO_TOKEN_RE.test(s);

/** Where a tapped timer notification should take the app. The server puts
 *  its whole TimerPayload in `data`; anything else (a test send, a future
 *  kind) goes nowhere rather than to a wrong recipe. */
export function notificationTarget(data: unknown): { recipeId: string; stepId: string } | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.kind !== "timer") return null;
  if (typeof d.recipeId !== "string" || !d.recipeId) return null;
  if (typeof d.stepId !== "string") return null;
  return { recipeId: d.recipeId, stepId: d.stepId };
}
