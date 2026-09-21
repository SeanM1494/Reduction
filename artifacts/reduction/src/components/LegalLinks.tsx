/**
 * client/src/components/LegalLinks.tsx — the two links Apple requires
 * wherever a subscription is offered (guideline 3.1.2: Terms of Use and
 * Privacy Policy, in the binary as well as the metadata), and that any
 * account screen owes people anyway.
 *
 * The pages are static HTML in public/ (served at /privacy and /terms —
 * see api-server/src/app.ts), so a link here is a plain anchor. `terms`
 * adds the one sentence Apple wants beside a price: what renews, and
 * where it is cancelled.
 */

import React from "react";

interface Props {
  /** Show the auto-renewal sentence above the links. */
  terms?: boolean;
  className?: string;
}

export default function LegalLinks({ terms = false, className = "" }: Props) {
  return (
    <div className={`rd-legal ${className}`.trim()}>
      {terms ? (
        <p className="rd-legal-terms">
          Renews automatically until cancelled. Manage or cancel in your App Store
          account settings, or on the website for a plan bought here.
        </p>
      ) : null}
      <p className="rd-legal-links">
        <a href="/terms">Terms of Use</a>
        <a href="/privacy">Privacy Policy</a>
      </p>
    </div>
  );
}
