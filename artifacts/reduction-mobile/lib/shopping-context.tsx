/**
 * lib/shopping-context.tsx — the shopping list, kept on this phone.
 *
 * The state and every rule about it are lib/shoppingList.ts (pure, tested);
 * this is the thin layer that loads it from disk per account, writes it
 * back on every change, and derives the view from the library. Nothing here
 * reaches the server (Sean, Oct 5: on this phone, survives closing the app,
 * not synced).
 *
 * It also owns the ONE add-to-list popup (components/shopping/
 * AddToListSheet.tsx), opened from anywhere with `openAddToList(entryId)`:
 * the Recipe Box's preview, the recipe screen, its ⋮ menu and the list's
 * own Recipes tab all reach the same sheet. A caller that is itself in a
 * Window or Sheet opens it from that dialog's onClosed (components/
 * Window.tsx says why).
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/auth-context';
import { useLibrary } from '@/lib/library-context';
import {
  deriveList,
  emptyList,
  parseList,
  pruneChecked,
  type ListView,
  type ShoppingListState,
} from '@/lib/shoppingList';
import { AddToListSheet } from '@/components/shopping/AddToListSheet';

const KEY = (userId: string) => `reduction_shopping_list:${userId}`;

interface ShoppingState {
  state: ShoppingListState;
  view: ListView;
  /** Apply a pure change (lib/shoppingList.ts) and save it. */
  change: (fn: (s: ShoppingListState) => ShoppingListState) => void;
  openAddToList: (entryId: string) => void;
}

const Ctx = createContext<ShoppingState | null>(null);

export function ShoppingListProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { entries, settled } = useLibrary();
  const [state, setState] = useState<ShoppingListState>(emptyList);
  const loadedFor = useRef<string | null>(null);
  const [addFor, setAddFor] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadedFor.current = null;
    setState(emptyList());
    if (!userId) return;
    AsyncStorage.getItem(KEY(userId))
      .then((raw) => {
        if (!live) return;
        setState(raw ? parseList(JSON.parse(raw)) : emptyList());
      })
      .catch(() => {
        // A damaged or unreadable file is an empty list, never a crash.
      })
      .finally(() => {
        if (live) loadedFor.current = userId;
      });
    return () => {
      live = false;
    };
  }, [userId]);

  const save = useCallback(
    (next: ShoppingListState) => {
      // Never write before the read has landed, or an empty list would
      // overwrite the saved one at launch.
      if (!userId || loadedFor.current !== userId) return;
      AsyncStorage.setItem(KEY(userId), JSON.stringify(next)).catch(() => {});
    },
    [userId]
  );

  const change = useCallback(
    (fn: (s: ShoppingListState) => ShoppingListState) => {
      setState((prev) => {
        const next = fn(prev);
        if (next !== prev) save(next);
        return next;
      });
    },
    [save]
  );

  const view = useMemo(() => deriveList(state, entries), [state, entries]);

  // Check marks for lines that have gone (a recipe edited or deleted) are
  // dropped once the library has settled, so the file never grows keys
  // nothing shows. Before it settles every line looks gone.
  useEffect(() => {
    if (!settled) return;
    const pruned = pruneChecked(state, view);
    if (pruned !== state) change(() => pruned);
  }, [settled, state, view, change]);

  const value = useMemo<ShoppingState>(
    () => ({ state, view, change, openAddToList: setAddFor }),
    [state, view, change]
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      <AddToListSheet entryId={addFor} onClose={() => setAddFor(null)} state={state} change={change} />
    </Ctx.Provider>
  );
}

export function useShoppingList(): ShoppingState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShoppingList outside ShoppingListProvider');
  return v;
}
