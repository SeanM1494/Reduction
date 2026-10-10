/**
 * lib/cooking-context.tsx — the cooking tray's state: which recipes this
 * phone has seen being cooked (lib/cookingTray.ts has the rules).
 *
 * Watches the library rather than the screens, so a step ticked in
 * Step-by-Step, in the diagram, or on another device (seen at the next
 * refresh) all count the same. The first time a recipe is seen it is only
 * remembered, never marked, so opening the app never fills the tray with
 * whatever was half done last month. Marks are kept on the phone per
 * account and never sent anywhere.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './auth-context';
import { useLibrary } from './library-context';
import {
  clearAll, clearOne, moveSignature, pin, pruneMarks, touch, trayList,
  type TrayMarks,
} from './cookingTray';
import type { Entry } from './api';

const KEY = (userId: string) => `reduction_cooking_tray:${userId}`;

interface CookingState {
  /** Recipes being cooked, newest movement first. */
  cooking: Entry[];
  /** ⋮ → Cook now. */
  cookNow: (id: string) => void;
  clearOneFromTray: (id: string) => void;
  clearTray: () => void;
}

const CookingContext = createContext<CookingState | null>(null);

export function CookingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { entries, settled } = useLibrary();
  const [marks, setMarks] = useState<TrayMarks>({});
  const [loaded, setLoaded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef(new Map<string, string>());

  // Read the stored marks for this account.
  useEffect(() => {
    let live = true;
    setLoaded(false);
    setMarks({});
    seen.current = new Map();
    if (!userId) return;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY(userId));
        const parsed = raw ? JSON.parse(raw) : null;
        if (live && parsed && typeof parsed === 'object') setMarks(parsed as TrayMarks);
      } catch {
        // No marks is the safe state: an empty tray.
      }
      if (live) setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [userId]);

  // Persist after every change once the stored copy has been read.
  useEffect(() => {
    if (!userId || !loaded) return;
    AsyncStorage.setItem(KEY(userId), JSON.stringify(marks)).catch(() => {});
  }, [userId, loaded, marks]);

  // See movement. A recipe met for the first time is remembered, not marked.
  useEffect(() => {
    if (!loaded || !settled) return;
    const t = Date.now();
    let next = marks;
    for (const e of entries) {
      const sig = moveSignature(e);
      const before = seen.current.get(e.id);
      seen.current.set(e.id, sig);
      if (before !== undefined && before !== sig) next = touch(next, e.id, t);
    }
    const pruned = pruneMarks(next, new Set(entries.map((e) => e.id)));
    if (pruned !== marks) setMarks(pruned);
  }, [entries, loaded, settled, marks]);

  // Re-evaluate the clock once a minute so an old mark expires on screen.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const cooking = useMemo(() => trayList(entries, marks, now), [entries, marks, now]);

  const cookNow = useCallback((id: string) => setMarks((m) => pin(m, id, Date.now())), []);
  const clearOneFromTray = useCallback((id: string) => setMarks((m) => clearOne(m, id)), []);
  const clearTray = useCallback(
    () => setMarks((m) => clearAll(m, Object.keys(m))),
    []
  );

  const value = useMemo(
    () => ({ cooking, cookNow, clearOneFromTray, clearTray }),
    [cooking, cookNow, clearOneFromTray, clearTray]
  );
  return <CookingContext.Provider value={value}>{children}</CookingContext.Provider>;
}

export function useCooking(): CookingState {
  const ctx = useContext(CookingContext);
  if (!ctx) throw new Error('useCooking must be used inside a CookingProvider.');
  return ctx;
}
