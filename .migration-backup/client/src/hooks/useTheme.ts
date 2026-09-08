/**
 * client/src/hooks/useTheme.ts — applies the active theme to the document
 * root as data attributes, so plain CSS (no JS-in-render styling) drives
 * every themed color across the whole app instantly.
 */

import { useCallback, useEffect, useState } from "react";
import {
  loadThemeMode,
  saveThemeMode,
  systemPrefersDark,
  type ThemeMode,
} from "../lib/theme";

export type ThemeBase = "light" | "dark";

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode | null>(() => loadThemeMode());
  const [systemDark, setSystemDark] = useState<boolean>(() => systemPrefersDark());

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Colorblind mode layers on top of the system base rather than fixing one,
  // and an unmade choice always tracks the system preference live.
  const base: ThemeBase =
    mode === "dark" ? "dark" : mode === "light" ? "light" : systemDark ? "dark" : "light";
  const colorblind = mode === "colorblind";

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", base);
    if (colorblind) root.setAttribute("data-colorblind", "true");
    else root.removeAttribute("data-colorblind");
  }, [base, colorblind]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    saveThemeMode(next);
  }, []);

  return { mode: mode ?? base, setMode, base };
}
