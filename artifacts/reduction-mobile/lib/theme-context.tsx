/**
 * lib/theme-context.tsx — the appearance preference, for the whole app.
 *
 * The web's useTheme: a stored choice (light, dark, colorblind) or none,
 * resolved against the system preference into a base palette and a
 * colorblind layer — lib/themePolicy.ts, under test. Stored in
 * AsyncStorage under one key, read once at boot; until it is read the
 * app follows the phone, which is what it would do for a first launch
 * anyway, so nothing flashes. `useColors` (hooks/useColors.ts) reads this
 * context and falls back to the phone when no provider is mounted.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseThemeMode, resolveTheme, type ThemeBase, type ThemeMode } from './themePolicy';

const KEY = 'reduction_theme';

export interface ThemeState {
  mode: ThemeMode;
  base: ThemeBase;
  colorblind: boolean;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (alive) setModeState(parseThemeMode(raw));
      })
      .catch(() => {
        /* no stored choice is the system choice */
      });
    return () => {
      alive = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(KEY, next).catch(() => {
      // The choice just won't persist past this launch.
    });
  }, []);

  const value = useMemo<ThemeState>(() => {
    const { base, colorblind } = resolveTheme(mode, system === 'dark' ? 'dark' : system === 'light' ? 'light' : null);
    return { mode, base, colorblind, setMode };
  }, [mode, system, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Null outside a provider (useColors then follows the phone). */
export function useThemeState(): ThemeState | null {
  return useContext(ThemeContext);
}
