/**
 * client/src/components/SignupStub.tsx — placeholder sign-up destination.
 *
 * The landing page's "Try your own recipe" CTA has nowhere real to go yet
 * (no accounts). This stands in for that until accounts ship, rather than
 * silently dropping the visitor into the anonymous library — see
 * client/src/App.tsx for how this is gated.
 */

import React from "react";

interface Props {
  onBack: () => void;
}

export default function SignupStub({ onBack }: Props) {
  return (
    <div className="rd-root rd-landing">
      <div className="rd-shell">
        <div className="rd-signup-stub">
          <button className="rd-back" onClick={onBack}>
            &larr; Back to the demo
          </button>
          <h1 className="rd-hero-title">Create your account</h1>
          <p className="rd-hero-sub">
            Sign-up is coming soon. Accounts will let you save your own
            recipes and pick up where you left off on any device &mdash; for
            now, head back and keep exploring the live demo.
          </p>
        </div>
      </div>
    </div>
  );
}
