/**
 * lib/authErrors.ts — the server's sign-in failure codes, in the words of
 * the person they happened to.
 *
 * PURE: no react-native, no `@/` alias, so `authErrors.test.ts` runs under
 * plain node. The sentences are the web's (artifacts/reduction/src/
 * components/SignIn.tsx, AUTH_ERRORS), verbatim: the same failure should
 * read the same on both clients, and the test pins every code the server
 * can send (server/routes/auth.ts) to a sentence, so a new code there
 * fails a run here instead of falling through to the generic line.
 *
 * The code arrives as `auth_error` on the `reduction-mobile://auth` deep
 * link the handshake ends on — every branch of the mobile start and
 * callback routes puts one there — and lib/auth-context.tsx turns it into
 * a sentence through `describeAuthError`.
 */

export const AUTH_ERRORS: Record<string, string> = {
  declined: 'That sign-in was cancelled before it finished.',
  expired: 'That sign-in took too long and expired. Starting again should work.',
  bad_callback: 'The sign-in came back incomplete. Please try again.',
  exchange_failed: "We couldn't complete that sign-in. Please try again.",
  start_failed: "We couldn't start that sign-in. Please try again in a moment.",
  not_configured: "Sign-in isn't available on this server right now.",
};

export const GENERIC_AUTH_ERROR = "That sign-in didn't work. Please try again.";

/** The sentence for a server code; the generic one for anything else,
 *  including a code that is not a string (a repeated query parameter
 *  parses as an array). */
export function describeAuthError(code: unknown): string {
  if (typeof code !== 'string') return GENERIC_AUTH_ERROR;
  return AUTH_ERRORS[code] ?? GENERIC_AUTH_ERROR;
}

/** Which sign-in buttons are worth offering: what /api/auth/providers
 *  reports. Null until the server has answered — a launch with no network
 *  must not read as "nothing is configured". */
export interface Providers {
  google: boolean;
  apple: boolean;
}

export type ProviderState = Providers | null;

/**
 * How the sign-in screen offers each provider, from what the server said.
 *
 * Unknown (null) offers both, enabled: the server could not be asked, and
 * hiding sign-in over a flaky connection at boot would strand someone who
 * can perfectly well sign in a moment later — the buttons' own failures
 * say what went wrong. Once the server has answered, the web's rule:
 * Google only when configured; Apple rendered disabled with "Coming soon"
 * when not, because someone who only signs in with Apple should see it is
 * coming rather than conclude this app will never support them; and a hint
 * when neither is.
 */
export interface SignInOffer {
  google: boolean;
  apple: 'enabled' | 'coming-soon';
  noneConfigured: boolean;
}

export function offerFrom(providers: ProviderState): SignInOffer {
  if (providers === null) return { google: true, apple: 'enabled', noneConfigured: false };
  return {
    google: providers.google,
    apple: providers.apple ? 'enabled' : 'coming-soon',
    noneConfigured: !providers.google && !providers.apple,
  };
}
