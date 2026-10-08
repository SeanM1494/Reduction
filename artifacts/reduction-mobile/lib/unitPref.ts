/**
 * lib/unitPref.ts — the measurement preference, one shared value.
 *
 * Settings writes it, recipe screens read it, and screens stay mounted, so it
 * is a value with listeners (like lib/boxStyle.ts) rather than something each
 * screen loads once. `flip` is the session-only override from the recipe menu.
 */

import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UnitPref } from '@/shared/amounts';
import { UNIT_PREF_KEY, effectiveUnitPref, parseUnitPref } from '@/lib/unitPrefPolicy';

let setting: UnitPref = 'written';
let flip: UnitPref | null = null;
let loaded: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function load(): Promise<void> {
  if (!loaded) {
    loaded = AsyncStorage.getItem(UNIT_PREF_KEY)
      .then((raw) => {
        setting = parseUnitPref(raw);
        emit();
      })
      .catch(() => {});
  }
  return loaded;
}

/** Settings: a deliberate choice, so it also drops this session's flip. */
export function setUnitPref(next: UnitPref): void {
  setting = next;
  flip = null;
  emit();
  AsyncStorage.setItem(UNIT_PREF_KEY, next).catch(() => {});
}

/** The recipe menu's flip: this session only, never stored. */
export function flipUnitPref(next: UnitPref): void {
  flip = next;
  emit();
}

/** What recipes should be drawn in right now. */
export function useUnitPref(): UnitPref {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    void load();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return effectiveUnitPref(setting, flip);
}

/** The saved setting alone (Settings shows this, not the flip). */
export function useUnitSetting(): UnitPref {
  const [, tick] = useState(0);
  useEffect(() => {
    const l = () => tick((n) => n + 1);
    listeners.add(l);
    void load();
    return () => {
      listeners.delete(l);
    };
  }, []);
  return setting;
}
