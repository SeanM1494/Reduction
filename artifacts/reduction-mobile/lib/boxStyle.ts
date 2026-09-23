/**
 * lib/boxStyle.ts — "Recipe box style" (Books or Grid), per device.
 *
 * Settings writes it and the Library reads it, and both tabs stay mounted,
 * so the choice is one shared value with listeners rather than something
 * each screen reads from storage once. Persisted in AsyncStorage like the
 * theme; the parsing (and the carry-over from the old in-library toggle)
 * is lib/libraryViewMode.ts's, under test.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BOX_STYLE_KEY, LEGACY_VIEW_KEY, parseBoxStyle, type LibraryView } from '@/lib/libraryViewMode';

let current: LibraryView = 'books';
let loaded: Promise<void> | null = null;
const listeners = new Set<(v: LibraryView) => void>();

function load(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.multiGet([BOX_STYLE_KEY, LEGACY_VIEW_KEY])
      .then(([[, raw], [, legacy]]) => {
        current = parseBoxStyle(raw, legacy);
        listeners.forEach((l) => l(current));
      })
      .catch(() => {});
  }
  return loaded;
}

export function setBoxStyle(next: LibraryView): void {
  current = next;
  listeners.forEach((l) => l(next));
  AsyncStorage.setItem(BOX_STYLE_KEY, next).catch(() => {});
}

export function useBoxStyle(): LibraryView {
  const [value, setValue] = useState<LibraryView>(current);
  useEffect(() => {
    listeners.add(setValue);
    void load();
    setValue(current);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
