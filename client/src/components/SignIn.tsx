/**
 * client/src/components/SignIn.tsx — the real sign-in screen.
 *
 * Replaces SignupStub, which stood in for this while there were no accounts.
 * The one piece of the stub that was never a placeholder — showing back the
 * recipe URL a visitor submitted from the finished demo — survives here,
 * because that URL is the reason most people arrive on this screen at all.
 *
 * The provider buttons are plain links, not fetch calls: OAuth begins with a
 * top-level navigation away from this origin, and an anchor is what that
 * actually is. The pending URL rides along as a query parameter, which the
 * server moves into the auth_states row so it survives the whole round trip —
 * including a provider that lands in a different tab.
 *
 * Only providers the server reports as configured are offered. A sign-in
 * button that 503s on click is worse than one that isn't there.
 */

import React from "react";

interface Props {
  /** A recipe URL carried over from the demo, if the visitor submitted one. */
  pendingUrl: string | null;
  providers: { google: boolean };
  authError: string | null;
  onBack: () => void;
}

/** Server-side failure codes, in the words of the person they happened to. */
const AUTH_ERRORS: Record<string, string> = {
  declined: "That sign-in was cancelled before it finished.",
  expired: "That sign-in took too long and expired. Starting again should work.",
  bad_callback: "The sign-in came back incomplete. Please try again.",
  exchange_failed: "We couldn't complete that sign-in. Please try again.",
  start_failed: "We couldn't start that sign-in. Please try again in a moment.",
  not_configured: "Sign-in isn't available on this server right now.",
};

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
    <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
  </svg>
);

const AppleMark = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="currentColor">
    <path d="M12.2 9.6c0-1.9 1.55-2.8 1.62-2.85-.88-1.3-2.26-1.47-2.75-1.49-1.17-.12-2.28.69-2.87.69-.59 0-1.5-.67-2.47-.65-1.27.02-2.44.74-3.09 1.87-1.32 2.29-.34 5.68.95 7.54.63.91 1.38 1.93 2.36 1.9.95-.04 1.31-.61 2.45-.61 1.14 0 1.47.61 2.47.59 1.02-.02 1.67-.93 2.29-1.84.72-1.05 1.02-2.07 1.04-2.12-.02-.01-2-.77-2-3.03zM10.4 3.6c.52-.63.87-1.51.77-2.39-.75.03-1.65.5-2.19 1.13-.48.55-.9 1.44-.79 2.29.83.07 1.69-.42 2.21-1.03z" />
  </svg>
);

export default function SignIn({ pendingUrl, providers, authError, onBack }: Props) {
  const startUrl = pendingUrl
    ? `/api/auth/google/start?pendingUrl=${encodeURIComponent(pendingUrl)}`
    : "/api/auth/google/start";

  return (
    <div className="rd-root rd-landing">
      <div className="rd-shell">
        <div className="rd-signin">
          <button className="rd-back" onClick={onBack}>
            &larr; Back to the demo
          </button>

          <h1 className="rd-hero-title">Save your recipes</h1>
          <p className="rd-hero-sub">
            An account keeps your diagrams and your progress, on every device
            you cook from.
          </p>

          {pendingUrl ? (
            <div className="rd-signin-pending">
              <p className="rd-signin-pending-label">
                Ready to diagram as soon as you&rsquo;re in:
              </p>
              <p className="rd-signup-url" title={pendingUrl}>
                {pendingUrl}
              </p>
            </div>
          ) : null}

          {authError ? (
            <p className="rd-error">
              {AUTH_ERRORS[authError] ?? "That sign-in didn't work. Please try again."}
            </p>
          ) : null}

          <div className="rd-signin-providers">
            {providers.google ? (
              <a className="rd-provider" href={startUrl}>
                <GoogleMark />
                <span>Continue with Google</span>
              </a>
            ) : null}

            {/* Present rather than hidden, because someone who only signs in
                with Apple should be able to see it is coming rather than
                conclude this app will never support them. Disabled, because a
                button that 503s is worse than no button. */}
            <button className="rd-provider is-soon" disabled>
              <AppleMark />
              <span>Continue with Apple</span>
              <span className="rd-provider-soon">Coming soon</span>
            </button>
          </div>

          {!providers.google ? (
            <p className="rd-hint">
              Sign-in isn&rsquo;t configured on this server yet &mdash; the demo
              works without an account in the meantime.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
