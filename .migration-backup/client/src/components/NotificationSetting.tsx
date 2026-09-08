/**
 * client/src/components/NotificationSetting.tsx — the timers toggle.
 *
 * MOST OF THIS COMPONENT IS THE iOS INSTALL CASE, and that is the right
 * proportion. On iOS, web push does not work in a Safari tab at all — the app
 * has to be on the Home Screen and launched from there. A plain toggle would
 * therefore do nothing, silently, for the majority of this app's users, and
 * they would conclude the feature is broken rather than that it is not
 * installed. So "needs-install" gets real instructions instead of a control.
 *
 * The permission request happens inside the tap handler with nothing awaited
 * before it — see the rules at the top of lib/push.ts. Everything expensive
 * (registering the worker, waiting for it to activate) already happened at
 * boot.
 */

import { useCallback, useEffect, useState } from "react";
import {
  disablePush,
  enablePush,
  isIos,
  pushState,
  type PushState,
} from "../lib/push";

export default function NotificationSetting() {
  const [state, setState] = useState<PushState | "loading">("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    pushState()
      .then((s) => alive && setState(s))
      .catch(() => alive && setState("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(async () => {
    setBusy(true);
    try {
      // Deliberately not awaiting anything before this call — on Safari the
      // user gesture does not survive it.
      const next = state === "on" ? await disablePush() : await enablePush();
      setState(next);
    } finally {
      setBusy(false);
    }
  }, [state]);

  if (state === "loading") return null;

  if (state === "unsupported") {
    return (
      <div className="rd-settings-card">
        <h2 className="rd-settings-heading">Timers</h2>
        <p className="rd-settings-line rd-settings-sub">
          This browser can&rsquo;t send notifications when the app is closed.
          Timers still count down while it&rsquo;s open.
        </p>
      </div>
    );
  }

  if (state === "needs-install") {
    return (
      <div className="rd-settings-card">
        <h2 className="rd-settings-heading">Timers</h2>
        <p className="rd-settings-line">
          To get a notification when a timer finishes, add Reduction to your
          Home Screen and open it from there.
        </p>
        <ol className="rd-settings-steps">
          <li>
            Tap the Share button {isIos() ? "at the bottom of Safari" : "in your browser"}
          </li>
          <li>Choose &ldquo;Add to Home Screen&rdquo;</li>
          <li>Open Reduction from the new icon</li>
        </ol>
        <p className="rd-settings-line rd-settings-sub">
          Apple only allows notifications for apps added this way. Until then
          timers still count down while the app is open.
        </p>
        {/* The caveat belongs here too, and arguably here most: this is the
            state that asks someone to go and do something on the strength of
            a promise. Telling them what they are getting only after they have
            installed it would be the overselling this copy exists to avoid. */}
        <p className="rd-settings-line rd-settings-sub rd-settings-caveat">
          Even then, alerts arrive while Reduction is open or has been used
          recently &mdash; the server sleeps when nobody&rsquo;s cooking.
          Always-on background alerts need a paid tier.
        </p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="rd-settings-card">
        <h2 className="rd-settings-heading">Timers</h2>
        <p className="rd-settings-line">
          Notifications are blocked for Reduction.
        </p>
        <p className="rd-settings-line rd-settings-sub">
          Turn them back on in Settings &rsaquo; Notifications &rsaquo;
          Reduction. The browser won&rsquo;t let the app ask again.
        </p>
      </div>
    );
  }

  const on = state === "on";
  return (
    <div className="rd-settings-card">
      <h2 className="rd-settings-heading">Timers</h2>
      <p className="rd-settings-line rd-settings-sub">
        {on
          ? "You'll get a notification when a timer finishes, on every device you've turned this on for."
          : "Get a notification when a timer finishes, on every device you turn this on for."}
      </p>
      <button
        className="rd-btn rd-settings-toggle"
        onClick={toggle}
        disabled={busy}
        aria-pressed={on}
      >
        {busy ? "One moment…" : on ? "Turn off notifications" : "Turn on notifications"}
      </button>
      {/* THE LIMITATION IS STATED WHETHER OR NOT IT IS SWITCHED ON, and it is
          stated before someone relies on it rather than after they miss a
          timer. Reduction's server sleeps when nobody is using it, so a timer
          that comes due long after the app was closed does not fire until
          someone opens it again. Promising "even if the app is closed" — which
          this copy did in its first draft — would be selling the version that
          needs an always-on server, and the first burnt dinner would be the
          user finding that out. */}
      <p className="rd-settings-line rd-settings-sub rd-settings-caveat">
        Alerts arrive while Reduction is open or has been used recently. The
        server sleeps when nobody&rsquo;s cooking, so a timer that finishes
        long after you closed the app waits until you come back. Always-on
        background alerts need a paid tier &mdash; they&rsquo;re planned, not
        built.
      </p>
    </div>
  );
}
