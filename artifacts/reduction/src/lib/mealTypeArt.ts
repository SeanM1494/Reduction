/**
 * client/src/lib/mealTypeArt.ts — what a card shows when a recipe has no
 * picture: a glyph on a tint keyed to its primary meal type (the mobile
 * app's lib/mealTypeArt.ts, same tints, same Feather glyphs — inline SVG
 * here, since the web has no icon font).
 */

import type { MealType } from "../shared/mealTypes";

export interface MealTypeArt {
  /** Feather icon body, drawn in a 24×24 box with stroke=currentColor. */
  svg: string;
  light: { bg: string; ink: string };
  dark: { bg: string; ink: string };
}

const F = {
  sunrise: '<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  package: '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  coffee: '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
  feather: '<path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/><line x1="16" y1="8" x2="2" y2="22"/><line x1="17.5" y1="15" x2="9" y2="15"/>',
  bookOpen: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
};

const ART: Record<MealType | "untagged", MealTypeArt> = {
  breakfast: { svg: F.sunrise, light: { bg: "#fbe3bf", ink: "#8a5a12" }, dark: { bg: "#4a3a1c", ink: "#f2c97a" } },
  lunch: { svg: F.sun, light: { bg: "#f4e7b3", ink: "#7a6410" }, dark: { bg: "#463e18", ink: "#e8d372" } },
  dinner: { svg: F.moon, light: { bg: "#f9d6cf", ink: "#8c2a1e" }, dark: { bg: "#4d2620", ink: "#f0a79a" } },
  dessert: { svg: F.gift, light: { bg: "#f3d6e3", ink: "#8a2d5c" }, dark: { bg: "#4a2538", ink: "#eba5c8" } },
  snack: { svg: F.package, light: { bg: "#eaeedd", ink: "#5b6d47" }, dark: { bg: "#2f3a26", ink: "#b9cc9c" } },
  side: { svg: F.layers, light: { bg: "#e2ead4", ink: "#4b6b3a" }, dark: { bg: "#2a3a24", ink: "#aacb92" } },
  drink: { svg: F.coffee, light: { bg: "#d9e6ea", ink: "#2f5c6b" }, dark: { bg: "#213a42", ink: "#9ccbd8" } },
  baking: { svg: F.box, light: { bg: "#efe0c8", ink: "#7a5528" }, dark: { bg: "#44341f", ink: "#e0be8c" } },
  salad: { svg: F.feather, light: { bg: "#d9efd3", ink: "#2f7a3b" }, dark: { bg: "#1f3a24", ink: "#9fdca7" } },
  untagged: { svg: F.bookOpen, light: { bg: "#f7f0df", ink: "#6b6154" }, dark: { bg: "#3a342c", ink: "#b3a898" } },
};

export function mealTypeArt(type: MealType | null | undefined): MealTypeArt {
  return (type && ART[type]) || ART.untagged;
}
