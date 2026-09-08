/**
 * client/src/lib/theme.ts — theme preference persistence.
 *
 * Three explicit modes a user can pick: light, dark, colorblind. Colorblind
 * swaps the ready/done accent pair for a colorblind-safe one but still
 * follows the system light/dark preference for its base palette, so it
 * layers on top of "light" or "dark" rather than being a fourth base.
 * When nothing has ever been chosen, the app follows the system preference
 * and keeps tracking it live.
 */

export type ThemeMode = "light" | "dark" | "colorblind";

const KEY = "logic-cooking:theme:v1";

export function loadThemeMode(): ThemeMode | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === "light" || raw === "dark" || raw === "colorblind" ? raw : null;
  } catch {
    return null;
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Private browsing or a full quota. The choice just won't persist.
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
