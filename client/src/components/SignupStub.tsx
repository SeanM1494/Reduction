/**
 * client/src/components/SignupStub.tsx — placeholder sign-up destination.
 *
 * The landing page's CTA has nowhere real to go yet (no accounts). This
 * stands in for that until accounts ship, rather than silently dropping the
 * visitor into the anonymous library — see client/src/App.tsx for how this
 * is gated.
 *
 * It carries one real piece of behavior, not a placeholder: a URL submitted
 * from the finished demo arrives here and is shown back, so the visitor can
 * see the thing they asked for is still queued. Continuing runs that
 * extraction immediately. When real sign-up replaces this screen, the URL
 * plumbing (lib/pendingUrl.ts, and App's completeSignup) is what it plugs
 * into — the account step goes where the button is.
 */

import React from "react";

interface Props {
  onBack: () => void;
  /** A recipe URL carried over from the demo, if the visitor submitted one. */
  pendingUrl: string | null;
  busy: boolean;
  error: string | null;
  onContinue: () => void;
}

export default function SignupStub({
  onBack,
  pendingUrl,
  busy,
  error,
  onContinue,
}: Props) {
  return (
    <div className="rd-root rd-landing">
      <div className="rd-shell">
        <div className="rd-signup-stub">
          <button className="rd-back" onClick={onBack} disabled={busy}>
            &larr; Back to the demo
          </button>
          <h1 className="rd-hero-title">Create your account</h1>

          {pendingUrl ? (
            <>
              <p className="rd-hero-sub">
                Sign-up is coming soon &mdash; but your link is saved, and
                we&rsquo;ll diagram it the moment you&rsquo;re in.
              </p>
              <p className="rd-signup-url" title={pendingUrl}>
                {pendingUrl}
              </p>
              {error ? <p className="rd-error">{error}</p> : null}
              <button className="rd-go" onClick={onContinue} disabled={busy}>
                {busy ? "Diagramming…" : "Continue and diagram it"}
              </button>
            </>
          ) : (
            <p className="rd-hero-sub">
              Sign-up is coming soon. Accounts will let you save your own
              recipes and pick up where you left off on any device &mdash; for
              now, head back and keep exploring the live demo.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
