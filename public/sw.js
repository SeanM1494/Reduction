/**
 * public/sw.js — the service worker, and ONLY for push.
 *
 * THERE IS DELIBERATELY NO `fetch` HANDLER HERE.
 *
 * A fetch handler is what turns a service worker into a cache, and a cache is
 * what strands people on a build from three deploys ago with no way to tell
 * them. iOS requires a REGISTERED service worker to deliver web push; it does
 * not require one that intercepts requests. So this file handles two events
 * and declines the entire class of stale-asset bugs that comes with the third.
 *
 * If offline support is ever wanted it is its own decision, with its own
 * versioning and update story — not a side effect of wanting timers to buzz.
 *
 * Plain JavaScript, served as a static asset from public/. It is not part of
 * the Vite bundle: a service worker has to sit at the origin root to claim
 * the whole scope, and hashing its filename would defeat the update check the
 * browser performs against a stable URL.
 */

self.addEventListener("install", () => {
  // No precache to build, so take over immediately rather than waiting for
  // every tab to close. There is nothing cached that a mixed-version pair of
  // clients could disagree about.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/**
 * A push arrived.
 *
 * ALWAYS shows a notification. iOS is strict here: a push handler that
 * resolves without calling showNotification can get the subscription revoked
 * or draw Safari's own generic "this site updated in the background" message,
 * which is worse than the notification we would have shown. So the choice is
 * not whether to show one but how loud it should be — and that is decided by
 * whether a window is already focused.
 */
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        // A malformed payload still gets a notification, because the
        // alternative on iOS is Safari's generic one.
      }

      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const focused = clientList.some((c) => c.focused);

      const title = data.title || "Timer done";
      const body = data.body || "Your timer is done.";

      await self.registration.showNotification(title, {
        body,
        icon: "/brand/reduction-icon-180.png",
        badge: "/brand/reduction-icon-32.png",
        // Collapse repeats for the same step rather than stacking them.
        tag: data.recipeId ? `timer:${data.recipeId}` : "timer",
        renotify: !focused,
        silent: focused,
        requireInteraction: false,
        data: {
          recipeId: data.recipeId || null,
          stepId: data.stepId || null,
        },
      });

      // Someone already looking at the page gets the in-app banner too —
      // StepsMode renders it from endsAt, so this only nudges a re-render.
      for (const client of clientList) {
        client.postMessage({ type: "timer-done", recipeId: data.recipeId });
      }
    })()
  );
});

/**
 * Tapping the notification.
 *
 * The app has no router — `openId` is component state — so the recipe is
 * named in a query parameter and App.tsx picks it up on boot exactly the way
 * takeAuthParams() already handles ?signed_in and ?pending. An already-open
 * window is focused and told directly, because reloading it would throw away
 * whatever the cook was in the middle of.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const recipeId = event.notification.data && event.notification.data.recipeId;
  const url = recipeId ? `/?open=${encodeURIComponent(recipeId)}` : "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clientList) {
        if ("focus" in client) {
          await client.focus();
          client.postMessage({ type: "open-recipe", recipeId });
          return;
        }
      }
      if (self.clients.openWindow) await self.clients.openWindow(url);
    })()
  );
});
