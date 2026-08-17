import React, { useState, useEffect, useCallback, useRef } from "react";
import Home from "./components/Home";
import RecipeView from "./components/RecipeView";
import SearchBar from "./components/SearchBar";
import ThemeToggle from "./components/ThemeToggle";
import LandingPage from "./components/LandingPage";
import SignIn from "./components/SignIn";
import { useTheme } from "./hooks/useTheme";
import { loadLibrary, saveLibrary, newEntryId, type Entry } from "./lib/storage";
import { readPendingUrl, writePendingUrl, clearPendingUrl } from "./lib/pendingUrl";
import {
  claimIfNeeded,
  fetchProviders,
  fetchSession,
  logout as endSession,
  type SessionUser,
} from "./lib/session";
import { ownerKeyClaimedBy } from "./lib/storage";

/**
 * The OAuth callback hands control back through the address bar. Reading the
 * parameters once and stripping them immediately keeps a reload from
 * re-running an extraction, and keeps a recipe URL out of the visible URL for
 * longer than the moment it takes to act on it.
 */
interface AuthParams {
  signedIn: boolean;
  pending: string | null;
  authError: string | null;
}

/**
 * Cached at module scope, not per component instance.
 *
 * This function reads the query string and then destroys it, which makes it
 * exactly the kind of thing that must not run twice. StrictMode mounts App
 * twice in development, and the second mount would parse a URL the first one
 * had already stripped — losing the pending recipe URL and the auth error,
 * and silently showing the landing page after a failed sign-in. Caching makes
 * the parse happen once per page load however many times App mounts.
 */
let cachedAuthParams: AuthParams | null = null;

function takeAuthParams(): AuthParams {
  if (cachedAuthParams) return cachedAuthParams;
  if (typeof window === "undefined") {
    return { signedIn: false, pending: null, authError: null };
  }
  const params = new URLSearchParams(window.location.search);
  const result: AuthParams = {
    signedIn: params.get("signed_in") === "1",
    pending: params.get("pending"),
    authError: params.get("auth_error"),
  };
  if (result.signedIn || result.pending || result.authError) {
    window.history.replaceState({}, "", window.location.pathname);
  }
  cachedAuthParams = result;
  return result;
}
import {
  extractFromUrl,
  extractFromText,
  extractFromFile,
  fileToBase64,
} from "./lib/api";
import type { Recipe } from "../../shared/layout";

export default function App() {
  const [library, setLibrary] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A URL submitted from the finished demo. Seeded from sessionStorage so a
  // reload mid-sign-up comes back to the sign-up flow still holding the link,
  // rather than dumping the visitor back on the demo having lost it.
  // Read once, before anything else, because two pieces of initial state
  // below depend on what came back in the URL.
  const [authParams] = useState(takeAuthParams);
  const [authError, setAuthError] = useState<string | null>(authParams.authError);
  const [pendingUrl, setPendingUrl] = useState<string | null>(() => readPendingUrl());
  /**
   * Open the sign-in screen straight away when there is a link waiting for an
   * account, or when a sign-in just failed. The second case matters: a
   * cancelled or expired handshake returns to "/" with an auth_error, and
   * showing the landing page there would drop the explanation on the floor
   * and leave the visitor with nothing to retry from.
   */
  const [showSignup, setShowSignup] = useState(
    () => readPendingUrl() !== null || !!authParams.authError
  );
  const [user, setUser] = useState<SessionUser | null>(null);
  const [providers, setProviders] = useState<{ google: boolean }>({ google: false });
  /** True when an anonymous library exists but could not be moved into the
   *  account. The rows are safe and still anonymous; this only means the move
   *  has not happened yet. */
  const [claimFailed, setClaimFailed] = useState(false);
  /**
   * A logged-out visitor has asked to see the recipes saved on this device.
   * Reaching the library without a session is now a deliberate act rather
   * than something that happens because a row happened to exist.
   */
  const [showAnonLibrary, setShowAnonLibrary] = useState(false);

  /**
   * Boot order matters: session, then claim, then library.
   *
   * The library is scoped by user_id once a session exists, so loading it
   * before the anonymous rows have been moved would show a signed-in user an
   * empty library — indistinguishable, to them, from having lost everything.
   * The claim goes first so that by the time anything renders, the rows are
   * where the query will look for them.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let signedIn: SessionUser | null = null;
      try {
        signedIn = await fetchSession();
        if (cancelled) return;
        setUser(signedIn);
      } catch (e) {
        // An unanswerable /me is treated as signed out: the library still
        // loads anonymously, which is the state that shows the most rather
        // than the least.
        console.error("[session]", e);
      }

      if (signedIn) {
        try {
          await claimIfNeeded(signedIn.id);
          if (!cancelled) setClaimFailed(false);
        } catch (e) {
          // Nothing was moved — the transaction rolled back — and the owner
          // key is untouched, so the next load retries. Surfaced rather than
          // swallowed so the UI can offer that retry now.
          if (!cancelled) setClaimFailed(true);
          console.error("[claim]", e);
        }
      }

      try {
        const saved = await loadLibrary();
        if (cancelled) return;
        setLibrary(saved);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Retry a claim that failed, and pick up whatever it moved. */
  const retryClaim = useCallback(async () => {
    if (!user) return;
    try {
      await claimIfNeeded(user.id);
      setClaimFailed(false);
      setLibrary(await loadLibrary());
    } catch (e) {
      setClaimFailed(true);
      console.error("[claim:retry]", e);
    }
  }, [user]);

  const persist = useCallback((next: Entry[]) => {
    setLibrary(next);
    saveLibrary(next);
  }, []);

  const addRecipe = useCallback(
    (recipe: Recipe) => {
      const entry: Entry = {
        id: newEntryId(),
        recipe,
        done: [],
        servings: recipe.servings,
        mode: "diagram",
        timer: null,
        savedAt: Date.now(),
      };
      setLibrary((prev) => {
        const next = [entry, ...prev];
        saveLibrary(next);
        return next;
      });
      setOpenId(entry.id);
    },
    []
  );

  const run = useCallback(
    async (fn: () => Promise<{ recipe: Recipe }>) => {
      setBusy(true);
      setError(null);
      try {
        const { recipe } = await fn();
        addRecipe(recipe);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [addRecipe]
  );

  // Same extraction call and the same addRecipe/setOpenId success path as
  // `run` above — just without the shared busy/error state, so a
  // web-result card in the header search can own its own loading spinner
  // and inline error (via the rejected promise) without touching the
  // Link/Paste/Photo tabs.
  const runSilently = useCallback(
    async (fn: () => Promise<{ recipe: Recipe }>) => {
      const { recipe } = await fn();
      addRecipe(recipe);
    },
    [addRecipe]
  );

  const submitPendingUrl = useCallback((url: string) => {
    writePendingUrl(url);
    setPendingUrl(url);
    setShowSignup(true);
  }, []);

  const leaveSignup = useCallback(() => {
    // Going back to the demo abandons the link — leaving it stored would send
    // the next reload straight back here for a URL they walked away from.
    clearPendingUrl();
    setPendingUrl(null);
    setError(null);
    setShowSignup(false);
  }, []);

  /**
   * What "the account now exists" runs. Extraction happens before the URL is
   * dropped, so a failure leaves the link intact and the visitor can retry
   * instead of having to remember what they pasted. On success addRecipe
   * opens the recipe, which takes the App out of the landing gate entirely.
   */
  const completeSignup = useCallback(async () => {
    if (!pendingUrl) {
      setShowSignup(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { recipe } = await extractFromUrl(pendingUrl);
      clearPendingUrl();
      setPendingUrl(null);
      addRecipe(recipe);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [pendingUrl, addRecipe]);

  /** Which sign-in buttons are worth offering. */
  useEffect(() => {
    let cancelled = false;
    fetchProviders()
      .then((p) => !cancelled && setProviders(p))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A recipe URL submitted before the account existed comes back through the
   * OAuth callback. Run it as soon as the library has loaded, so the visitor
   * lands on the diagram they actually asked for rather than an empty page
   * with their link forgotten.
   */
  const pendingRan = useRef(false);
  useEffect(() => {
    if (!loaded || !user || pendingRan.current) return;
    const url = authParams.pending;
    if (!url) return;
    pendingRan.current = true;
    clearPendingUrl();
    setPendingUrl(null);
    run(() => extractFromUrl(url));
  }, [loaded, user, authParams.pending, run]);

  const signOut = useCallback(async () => {
    try {
      await endSession();
    } catch (e) {
      console.error("[logout]", e);
    }
    // Sign-out leaves the anonymous library, which is empty for anyone whose
    // rows were claimed — so this lands on the landing page, which says as
    // much rather than showing an empty shelf that reads as data loss.
    setUser(null);
    setOpenId(null);
    setLibrary([]);
    setShowSignup(false);
    setShowAnonLibrary(false);
  }, []);

  const entry = library.find((e) => e.id === openId) || null;
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  // Nothing renders until the session is known. Without this a signed-in
  // visitor flashes the landing page while /api/auth/me is in flight, which
  // reads as being logged out.
  if (!loaded) {
    return <div className="rd-root rd-booting" aria-busy="true" />;
  }

  // No session means the landing page. Row count gets no vote: deciding the
  // view partly on whether the anonymous library happened to have rows made
  // the same URL in the same browser show the library one load and the demo
  // the next, depending only on what the server had at that instant.
  //
  // `openId` still wins, so a recipe someone just extracted opens directly
  // rather than bouncing them back to the demo, and showAnonLibrary is the
  // explicit way in for a logged-out browser that has saved things.
  if (!user && !openId && !showAnonLibrary) {
    return showSignup ? (
      <SignIn
        pendingUrl={pendingUrl}
        providers={providers}
        authError={authError}
        onBack={leaveSignup}
      />
    ) : (
      <LandingPage
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        onTryOwnRecipe={() => setShowSignup(true)}
        onSubmitUrl={submitPendingUrl}
        onSignIn={() => {
          setAuthError(null);
          setShowSignup(true);
        }}
        // Only tell someone their recipes are behind sign-in if this browser
        // has actually had an account. A first-time visitor has nothing
        // waiting for them and should not be told otherwise.
        returning={ownerKeyClaimedBy() !== null}
        // Recipes saved on this device without an account. Anonymous saving
        // is a supported state — it is what the demo's funnel produces — so
        // it needs a door, or those recipes are unreachable after a reload.
        savedCount={library.length}
        onViewLibrary={() => setShowAnonLibrary(true)}
      />
    );
  }

  return (
    <div className="rd-root">
      <nav className="rd-nav no-print">
        <button className="rd-brand" onClick={() => setOpenId(null)}>
          <img
            className="rd-logo"
            src="/brand/reduction-icon-transparent.svg"
            alt=""
            aria-hidden="true"
          />
          Reduction
        </button>
        <SearchBar
          library={library}
          onOpen={setOpenId}
          onPickWebResult={(url) => runSilently(() => extractFromUrl(url))}
        />
        <div className="rd-nav-right">
          {entry ? null : (
            <span className="rd-nav-meta">{library.length} saved</span>
          )}
          {user ? (
            <button className="rd-btn rd-signout" onClick={signOut}>
              Sign out
            </button>
          ) : (
            <button className="rd-btn" onClick={() => setShowSignup(true)}>
              Sign in
            </button>
          )}
          <ThemeToggle mode={themeMode} onChange={setThemeMode} />
        </div>
      </nav>

      <div className="rd-shell">
        {claimFailed ? (
          <div className="rd-claim-banner" role="status">
            <span>
              Your recipes from before you signed in haven&rsquo;t been added yet.
              They&rsquo;re safe &mdash; nothing was lost.
            </span>
            <button className="rd-btn" onClick={retryClaim}>
              Retry
            </button>
          </div>
        ) : null}
        {entry ? (
          <RecipeView
            key={entry.id}
            entry={entry}
            onBack={() => setOpenId(null)}
            onUpdate={(updated) =>
              persist(library.map((e) => (e.id === updated.id ? updated : e)))
            }
            onDelete={() => {
              persist(library.filter((e) => e.id !== entry.id));
              setOpenId(null);
            }}
          />
        ) : (
          <Home
            library={library}
            busy={busy}
            error={error}
            onDismissError={() => setError(null)}
            onOpen={setOpenId}
            onImportUrl={(url) => run(() => extractFromUrl(url))}
            onImportText={(text) => run(() => extractFromText(text))}
            onImportFile={(file) =>
              run(async () => {
                const data = await fileToBase64(file);
                return extractFromFile(data, file.type);
              })
            }
          />
        )}
      </div>
    </div>
  );
}
