/**
 * lib/auth-context.tsx — sign-in state for the whole app.
 *
 * Mobile requires a real account before any extraction or library use (there
 * is no anonymous trial here — see the long note in server/lib/trial.ts for
 * why a browser-cookie trial cannot travel to a native app). So this context
 * is the gate: nothing else renders until it has decided whether a token
 * exists, and everything that needs to know "who is this" or "are they
 * allowed to extract" reads it from here rather than re-fetching.
 *
 * The handshake itself is a web-based OAuth round trip (WebBrowser.
 * openAuthSessionAsync against this server's own /api/auth/mobile/* routes),
 * ending in a one-time code delivered over the `reduction-mobile://auth` deep
 * link, traded here for a bearer token — see server/routes/auth.ts for the
 * server half and why the token itself is never put in the URL.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import {
  type Entitlement,
  exchangeMobileCode,
  fetchBillingConfig,
  fetchEntitlement,
  fetchMe,
  mobileStartUrl,
  setAuthToken,
  signOutServer,
} from './api';
import { deleteSecureItem, getSecureItem, setSecureItem } from './secure-storage';

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'reduction_session_token';

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
}

interface AuthState {
  loading: boolean;
  token: string | null;
  user: AuthUser | null;
  entitlement: Entitlement | null;
  webUrl: string | null;
  signingIn: 'google' | 'apple' | null;
  signInError: string | null;
  signIn: (provider: 'google' | 'apple') => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [webUrl, setWebUrl] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState<'google' | 'apple' | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  /** Drops the stored token and signed-in state, e.g. after the server
   *  reports no user for a bearer token we're holding — an expired or
   *  revoked session. Without this, `Gate` (which only checks token
   *  presence) would keep the account-scoped screens mounted while every
   *  request them makes fails, stranding the user in an unusable shell
   *  instead of returning them to sign-in. */
  const forgetSession = useCallback(async () => {
    await deleteSecureItem(TOKEN_KEY).catch(() => {});
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setEntitlement(null);
  }, []);

  const loadAccount = useCallback(async () => {
    try {
      const [me, billing] = await Promise.all([
        fetchMe(),
        fetchEntitlement().catch(() => ({ entitlement: null })),
      ]);
      if (!me.user) {
        // The token we're holding is no longer valid server-side (expired,
        // revoked, or the session was cleared) — treat it the same as a
        // sign-out rather than leaving a dead token installed.
        await forgetSession();
        return;
      }
      setUser({
        id: (me.user as any).id,
        email: (me.user as any).email ?? null,
        name: (me.user as any).displayName ?? (me.user as any).name ?? null,
      });
      setEntitlement(billing.entitlement ?? null);
    } catch {
      // A failed *network* refresh leaves the previous state in place rather
      // than signing someone out over a flaky connection — only an explicit
      // "no user" response above is treated as an invalid session.
    }
  }, [forgetSession]);

  useEffect(() => {
    (async () => {
      try {
        const stored = await getSecureItem(TOKEN_KEY);
        if (stored) {
          setAuthToken(stored);
          setToken(stored);
          await loadAccount();
        }
        const cfg = await fetchBillingConfig().catch(() => null);
        if (cfg) setWebUrl(cfg.webUrl);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadAccount]);

  const signIn = useCallback(
    async (provider: 'google' | 'apple') => {
      setSignInError(null);
      setSigningIn(provider);
      try {
        const redirectUri = Linking.createURL('auth');
        const result = await WebBrowser.openAuthSessionAsync(
          mobileStartUrl(provider, redirectUri),
          redirectUri
        );
        if (result.type !== 'success' || !result.url) {
          if (result.type !== 'cancel' && result.type !== 'dismiss') {
            setSignInError('Sign-in did not complete. Please try again.');
          }
          return;
        }
        const parsed = Linking.parse(result.url);
        const code = parsed.queryParams?.code;
        const authError = parsed.queryParams?.auth_error;
        if (authError) {
          setSignInError('Sign-in was declined or could not start. Please try again.');
          return;
        }
        if (typeof code !== 'string' || !code) {
          setSignInError('Sign-in did not return a valid code. Please try again.');
          return;
        }
        const { token: newToken } = await exchangeMobileCode(code);
        await setSecureItem(TOKEN_KEY, newToken);
        setAuthToken(newToken);
        setToken(newToken);
        await loadAccount();
      } catch (e) {
        setSignInError((e as Error).message || 'Could not sign in. Please try again.');
      } finally {
        setSigningIn(null);
      }
    },
    [loadAccount]
  );

  const signOut = useCallback(async () => {
    await signOutServer();
    await forgetSession();
  }, [forgetSession]);

  const refresh = useCallback(async () => {
    await loadAccount();
  }, [loadAccount]);

  const value = useMemo<AuthState>(
    () => ({
      loading,
      token,
      user,
      entitlement,
      webUrl,
      signingIn,
      signInError,
      signIn,
      signOut,
      refresh,
    }),
    [loading, token, user, entitlement, webUrl, signingIn, signInError, signIn, signOut, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider.');
  return ctx;
}
