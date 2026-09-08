/**
 * client/src/components/AccountId.tsx — your account id, copyable.
 *
 * WHY A COPY BUTTON AND NOT A PRETTIER ID. `users.id` is a v4 UUID: 36
 * characters, not memorable, and not something anyone will read down a phone.
 * That is fine for what this solves — "support asked for my account id" is a
 * copy-and-paste job, and a button removes the only real difficulty (a
 * one-character transcription error in a 36-character string, which is
 * invisible until the lookup fails).
 *
 * It is deliberately NOT a short handle. A user-chosen username is a real
 * feature with uniqueness, editability and collision behaviour of its own,
 * and nothing here needs one.
 *
 * The clipboard API is unavailable on insecure origins and can be refused by
 * the browser, so the id is always rendered as selectable text and the button
 * is an accelerator rather than the only way to get at it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export default function AccountId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      // Reverts rather than latching: a button that says "Copied" for ever
      // stops telling you whether the NEXT tap worked.
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Refused or unavailable. The text is selectable, so there is still a
      // way through and nothing needs to be said about it.
    }
  }, [id]);

  return (
    <div className="rd-accountid">
      <span className="rd-accountid-label">Account ID</span>
      <div className="rd-accountid-row">
        <code className="rd-accountid-value">{id}</code>
        <button
          className="rd-btn rd-accountid-copy"
          onClick={copy}
          aria-label="Copy account ID"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
