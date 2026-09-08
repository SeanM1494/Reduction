/**
 * client/src/lib/push.ts — service worker registration and the subscribe flow.
 *
 * THREE iOS RULES SHAPE THIS FILE, and none of them apply on desktop, so all
 * three are easy to break here and impossible to notice here:
 *
 *  1. WEB PUSH ONLY WORKS IN AN INSTALLED PWA. Safari delivers nothing to a
 *     regular tab — Share -> Add to Home Screen, then launch from the icon.
 *     `installedStandalone()` is what the UI uses to explain that rather than
 *     rendering a toggle that silently fails.
 *  2. PERMISSION MUST BE ASKED INSIDE A USER GESTURE, and Safari is stricter
 *     than Chrome: the transient activation does not survive a setTimeout, so
 *     nothing may be deferred between the tap and requestPermission().
 *  3. THE REGISTRATION MUST ALREADY EXIST WHEN THE TAP ARRIVES. Doing the
 *     `navigator.serviceWorker.register()` await inside the click handler is
 *     a documented way to lose the activation and get NotAllowedError anyway.
 *     So `initPush()` runs at boot and `enablePush()` only consumes what it
 *     produced.
 */

const SW_URL = "/sw.js";

let registration: ServiceWorkerRegistration | null = null;
let registering: Promise<ServiceWorkerRegistration | null> | null = null;

export function pushSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Launched from the Home Screen rather than in a browser tab. On iOS this is
 *  the difference between push working and push not existing. */
export function installedStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone;
  return (
    iosStandalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true
  );
}

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

/**
 * Register the worker. Call once at boot — see rule 3 above.
 *
 * Failure is not an error anyone needs to see: without a registration the
 * toggle stays off and the in-app countdown is unaffected.
 */
export function initPush(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return Promise.resolve(null);
  if (registering) return registering;
  registering = navigator.serviceWorker
    .register(SW_URL)
    .then(async (reg) => {
      // `ready` resolves once there is an ACTIVE worker. Subscribing against
      // a merely-installing registration throws.
      await navigator.serviceWorker.ready;
      registration = reg;
      return reg;
    })
    .catch((e) => {
      console.error("[push] service worker registration failed:", e);
      return null;
    });
  return registering;
}

export type PushState =
  | "unsupported"
  | "needs-install"
  | "denied"
  | "off"
  | "on";

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  // Checked before permission: on iOS a tab cannot be granted at all, and
  // "denied" would be a misleading thing to tell someone who just has not
  // added the app to their Home Screen yet.
  if (isIos() && !installedStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  const reg = registration ?? (await initPush());
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  return sub ? "on" : "off";
}

/** VAPID keys travel as base64url and applicationServerKey wants bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function vapidPublicKey(): Promise<string | null> {
  try {
    const res = await fetch("/api/push/config");
    if (!res.ok) return null;
    const body = (await res.json()) as { vapidPublicKey: string | null };
    return body.vapidPublicKey;
  } catch {
    return null;
  }
}

/**
 * Turn notifications on. MUST be called directly from a tap handler.
 *
 * Note the ordering: everything that can be prepared in advance already was,
 * in initPush(). requestPermission() is reached with as little between it and
 * the gesture as possible, because on Safari the activation is spent by the
 * first await that yields to the event loop in the wrong way.
 */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (isIos() && !installedStandalone()) return "needs-install";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";

  const reg = registration ?? (await initPush());
  if (!reg) return "unsupported";

  const key = await vapidPublicKey();
  if (!key) return "unsupported";

  try {
    // An existing subscription is reused rather than replaced: the endpoint
    // is the row's primary key server-side, so re-subscribing is an upsert,
    // not a duplicate.
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      }));

    const json = sub.toJSON() as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
    };
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: json.endpoint,
        keys: json.keys,
        userAgent: navigator.userAgent,
      }),
    });
    if (!res.ok) {
      // Do not leave a live browser subscription the server has no row for —
      // it would push nothing and read as "on" for ever.
      await sub.unsubscribe().catch(() => {});
      return "off";
    }
    return "on";
  } catch (e) {
    console.error("[push] subscribe failed:", e);
    return "off";
  }
}

export async function disablePush(): Promise<PushState> {
  const reg = registration ?? (await initPush());
  if (!reg) return "unsupported";
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return "off";
  const endpoint = sub.endpoint;
  // Server first: if the browser drops it and the DELETE then fails, the row
  // survives pointing at an endpoint nobody holds, and every future timer
  // pays a send that 410s.
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
  return "off";
}
