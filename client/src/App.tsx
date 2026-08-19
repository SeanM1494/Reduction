import React, { useState, useEffect, useCallback, useRef } from "react";
import Home from "./components/Home";
import MyRecipes from "./components/MyRecipes";
import SettingsTab from "./components/SettingsTab";
import BottomNav, { type Tab } from "./components/BottomNav";
import RecipeView from "./components/RecipeView";
import SearchBar from "./components/SearchBar";
import LandingPage from "./components/LandingPage";
import SignIn from "./components/SignIn";
import { useTheme } from "./hooks/useTheme";
import {
  loadLibrary,
  saveLibrary,
  saveTrialRecipe,
  refreshLibrary,
  onEntryReplaced,
  onSyncNotice,
  newEntryId,
  type Entry,
} from "./lib/storage";
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
   * The one recipe a signed-out visitor has extracted, held in memory.
   *
   * It is also stored server-side against the browser's trial so it survives
   * sign-up — see server/lib/trial.ts. That is one recipe pending an account,
   * not an anonymous library, and the distinction is the whole design: "no
   * anonymous library" means many recipes indefinitely, not that a visitor
   * loses the diagram they are looking at the moment they decide to keep it.
   */
  const [trialEntry, setTrialEntry] = useState<Entry | null>(null);
  const [trialSpent, setTrialSpent] = useState(false);

  /**
   * Which bottom-nav tab is showing. Chosen once, after the library loads:
   * a returning cook lands on their collection, a new account on Find,
   * because each is the screen that person came for. Ephemeral by design —
   * remembering the tab across sessions would mean sometimes opening on
   * Settings, which nobody comes back for.
   */
  const [tab, setTab] = useState<Tab>("find");
  const tabChosen = useRef(false);

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

      // Only a signed-in visitor has a library. A signed-out one has at most
      // the single trial recipe, which lives in memory and on its own row.
      if (signedIn) {
        try {
          const saved = await loadLibrary();
          if (cancelled) return;
          setLibrary(saved);
          if (!tabChosen.current) {
            tabChosen.current = true;
            setTab(saved.length ? "recipes" : "find");
          }
        } catch (e) {
          if (!cancelled) setError((e as Error).message);
        }
      }
      if (!cancelled) setLoaded(true);
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

  /** A conflict was resolved with a loser, or another device changed
   *  something this one was looking at. Shown, not swallowed — the one
   *  forbidden outcome of the sync design is a quiet loss. */
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  /**
   * The sync layer's two ways of changing state underneath the UI:
   * a 409 merge replaces one entry, and both channels report notices.
   * Registered once; storage keeps at most one replacement handler.
   */
  useEffect(() => {
    const offReplace = onEntryReplaced((entry) => {
      setLibrary((prev) => prev.map((e) => (e.id === entry.id ? entry : e)));
    });
    const offNotice = onSyncNotice((n) => setSyncNotice(n.message));
    return () => {
      offReplace();
      offNotice();
    };
  }, []);

  /**
   * Refetch on focus — the cheapest and highest-value piece of the sync
   * design. The laptop that comes back to the foreground learns about
   * tonight's phone cooking BEFORE its next write, so most conflicts stop
   * existing rather than needing the 409 path at all. Signed-in only: a
   * signed-out browser has no server library to drift from.
   */
  const userRef = useRef(user);
  userRef.current = user;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  useEffect(() => {
    let running = false;
    const refresh = async () => {
      if (!userRef.current || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const next = await refreshLibrary(libraryRef.current);
        setLibrary(next);
      } catch (e) {
        // A failed refresh is a non-event: local state stands, and the next
        // write still has the 409 path to protect it.
        console.warn("[sync:refresh]", e);
      } finally {
        running = false;
      }
    };
    window.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
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
    async (fn: () => Promise<{ recipe: Recipe; trialRecipeId?: string }>) => {
      setBusy(true);
      setError(null);
      try {
        const { recipe, trialRecipeId } = await fn();
        if (user) {
          addRecipe(recipe);
          return;
        }
        // Signed out: the server has already parked this against the trial,
        // so nothing is POSTed here. It is shown from memory and claimed into
        // the account at sign-up.
        const entry: Entry = {
          id: trialRecipeId ?? newEntryId(),
          recipe,
          done: [],
          servings: recipe.servings,
          mode: "diagram",
          timer: null,
          savedAt: Date.now(),
        };
        setTrialEntry(entry);
        setTrialSpent(true);
        setOpenId(entry.id);
      } catch (e) {
        const err = e as Error & { code?: string };
        // The server refused because the free extraction is gone. Say so and
        // let the paste box become the sign-up path. Keyed on the code the
        // server sends for exactly this; the message match is kept only as a
        // fallback for a response that predates it.
        if (err.code === "trial_spent" || /free recipe/i.test(err.message)) {
          setTrialSpent(true);
        }
        setError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [addRecipe, user]
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
    setTrialEntry(null);
  }, []);

  const entry =
    library.find((e) => e.id === openId) ||
    (trialEntry && trialEntry.id === openId ? trialEntry : null);
  const viewingTrial = !!entry && entry === trialEntry;
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
  // rather than bouncing them back to the demo — which is what the free
  // trial extraction relies on.
  if (!user && !openId) {
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
        onExtractUrl={(url) => run(() => extractFromUrl(url))}
        trialSpent={trialSpent}
        busy={busy}
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
        {/* Sign out and the theme toggle moved to the Settings tab; the
            search bar into Find. The nav is a brand line, which is all a
            phone has room to spend on it. */}
      </nav>

      <div className={`rd-shell ${entry ? "" : "rd-shell-tabbed"}`}>
        {syncNotice ? (
          <div className="rd-claim-banner" role="status">
            <span>{syncNotice}</span>
            <button className="rd-btn" onClick={() => setSyncNotice(null)}>
              OK
            </button>
          </div>
        ) : null}
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
          <>
            {/* The strongest moment to ask, and the worst to lose their work.
                Persistent rather than modal: they are reading a diagram, and
                a dialog over it would be the wrong trade. The recipe is
                already stored against the trial, so signing up moves it into
                the account rather than re-extracting it. */}
            {viewingTrial ? (
              <div className="rd-trial-bar" role="status">
                <span>
                  <strong>This is your free recipe.</strong> Create an account
                  and it stays in your library.
                </span>
                <button className="rd-go" onClick={() => setShowSignup(true)}>
                  Save it
                </button>
              </div>
            ) : null}
            <RecipeView
              key={entry.id}
              entry={entry}
              onBack={() => setOpenId(null)}
              onUpdate={(updated) => {
                // The trial recipe has no LIBRARY row, but it does have a
                // row — parked under trial:<id> until signup claims it — and
                // that row is patchable, so edits and progress persist and
                // survive the claim. See server/routes/trial.ts.
                if (viewingTrial) {
                  setTrialEntry(updated);
                  saveTrialRecipe(updated);
                } else {
                  persist(library.map((e) => (e.id === updated.id ? updated : e)));
                }
              }}
              onDelete={() => {
                if (viewingTrial) {
                  setTrialEntry(null);
                } else {
                  persist(library.filter((e) => e.id !== entry.id));
                }
                setOpenId(null);
              }}
            />
          </>
        ) : tab === "find" ? (
          <>
            <div className="rd-find-search">
              <SearchBar
                library={library}
                onOpen={setOpenId}
                onPickWebResult={(url) => runSilently(() => extractFromUrl(url))}
              />
            </div>
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
          </>
        ) : tab === "recipes" ? (
          <MyRecipes library={library} onOpen={setOpenId} onFind={() => setTab("find")} />
        ) : user ? (
          <SettingsTab
            user={user}
            themeMode={themeMode}
            onThemeChange={setThemeMode}
            onSignOut={signOut}
            recipeCount={library.length}
          />
        ) : null}
      </div>

      {/* Hidden while a recipe is open: cooking gets the full viewport, and
          RecipeView is already built as a 100svh page with its own bar. */}
      {entry ? null : <BottomNav tab={tab} onPick={setTab} />}
    </div>
  );
}
