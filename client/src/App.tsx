import React, { useState, useEffect, useCallback } from "react";
import Home from "./components/Home";
import RecipeView from "./components/RecipeView";
import { loadLibrary, saveLibrary, type Entry } from "./lib/storage";
import {
  extractFromUrl,
  extractFromText,
  extractFromFile,
  fileToBase64,
} from "./lib/api";
import { SEED } from "./data/seed";
import type { Recipe } from "../../shared/layout";

export default function App() {
  const [library, setLibrary] = useState<Entry[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = loadLibrary();
    if (saved.length) {
      setLibrary(saved);
      return;
    }
    // First run gets the cheesecake so the app is not an empty box.
    // Delete this branch and the seed file once you have real recipes.
    const seeded: Entry[] = [
      {
        id: "seed",
        recipe: SEED,
        done: [],
        servings: SEED.servings,
        savedAt: Date.now(),
      },
    ];
    setLibrary(seeded);
    saveLibrary(seeded);
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

  const entry = library.find((e) => e.id === openId) || null;

  return (
    <div className="rd-root">
      <nav className="rd-nav no-print">
        <button className="rd-brand" onClick={() => setOpenId(null)}>
          <span className="rd-logo" aria-hidden="true" />
          Reduction
        </button>
        {entry ? null : (
          <span className="rd-nav-meta">{library.length} saved</span>
        )}
      </nav>

      <div className="rd-shell">
        {entry ? (
          <RecipeView
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
