import React, { useState, useEffect, useCallback } from "react";
import Home from "./components/Home";
import RecipeView from "./components/RecipeView";
import SearchBar from "./components/SearchBar";
import ThemeToggle from "./components/ThemeToggle";
import LandingPage from "./components/LandingPage";
import SignupStub from "./components/SignupStub";
import { useTheme } from "./hooks/useTheme";
import { loadLibrary, saveLibrary, type Entry } from "./lib/storage";
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
  const [showSignup, setShowSignup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
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

  const persist = useCallback((next: Entry[]) => {
    setLibrary(next);
    saveLibrary(next);
  }, []);

  const addRecipe = useCallback(
    (recipe: Recipe) => {
      const entry: Entry = {
        id: `r${Date.now()}`,
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

  const entry = library.find((e) => e.id === openId) || null;
  const { mode: themeMode, setMode: setThemeMode } = useTheme();

  // No accounts yet, so "logged out" is approximated as "nothing saved" —
  // the only signal this app currently has. A returning user with at least
  // one saved recipe always skips straight past this. Gated on `loaded` so
  // a user who DOES have recipes never flashes the landing page while the
  // very first /api/library GET is still in flight.
  if (loaded && library.length === 0 && !openId) {
    return showSignup ? (
      <SignupStub onBack={() => setShowSignup(false)} />
    ) : (
      <LandingPage
        themeMode={themeMode}
        onThemeChange={setThemeMode}
        onTryOwnRecipe={() => setShowSignup(true)}
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
          <ThemeToggle mode={themeMode} onChange={setThemeMode} />
        </div>
      </nav>

      <div className="rd-shell">
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
