/**
 * lib/latestRequest.ts — "only the newest one counts", for a control that
 * can fire again before its last request has answered.
 *
 * The web search is the case that needs it. Typing a new query clears the
 * results, but the request the previous query started is still running, and
 * when it lands it writes ITS results into the panel — under a search box
 * that now says something else. Nothing crashes and nothing looks wrong;
 * you just tap a result for a search you did not make.
 *
 * The obvious guard — refuse to start a second search while the first is
 * running — is what the search box did, and it is worse: it locks the
 * control for as long as the stale request takes, so the person is made to
 * wait for an answer that is already useless.
 *
 * So: starting supersedes. The one in flight is ABORTED rather than merely
 * ignored, because a search is an upstream API call the user never pays
 * for (CLAUDE.md, "The URL cache") — letting a superseded one run to
 * completion spends money on an answer nothing will read. And every attempt
 * carries its own generation, so a reply that was already in the socket
 * when the abort went out is still dropped rather than shown.
 *
 * Pure: no react-native import, no `@/` alias, so the test runner can load
 * it. AbortController is standard in every runtime this ships to.
 */

export interface Attempt {
  /** Pass into the request; fires when a newer attempt supersedes this. */
  readonly signal: AbortSignal;
  /** False once something newer has begun, or everything was cancelled.
   *  Check it before writing any state from the reply. Settling does NOT
   *  make an attempt stale — a `finally` block that clears a spinner runs
   *  after `settle()` and still has to know whether the spinner is its. */
  isCurrent(): boolean;
  /** Call when this attempt has settled, however it settled. Only the live
   *  attempt clears `pending`; a late stale one leaves it alone. */
  settle(): void;
}

export interface Latest {
  /** Supersede whatever is running and start a new attempt. */
  begin(): Attempt;
  /** Abort what is running and make every outstanding attempt stale.
   *  Safe to call when nothing is running. */
  cancel(): void;
  /** True while an attempt is in flight and has not been superseded. */
  pending(): boolean;
}

export function createLatest(): Latest {
  let inFlight: AbortController | null = null;
  let generation = 0;

  const cancel = () => {
    inFlight?.abort();
    inFlight = null;
    generation += 1;
  };

  return {
    begin(): Attempt {
      cancel();
      const controller = new AbortController();
      inFlight = controller;
      const mine = generation;
      return {
        signal: controller.signal,
        isCurrent: () => mine === generation,
        settle: () => {
          if (inFlight === controller) inFlight = null;
        },
      };
    },
    cancel,
    pending: () => inFlight !== null,
  };
}
