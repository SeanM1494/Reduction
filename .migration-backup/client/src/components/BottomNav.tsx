/**
 * client/src/components/BottomNav.tsx — the app's three destinations.
 *
 * Find, My Recipes, Settings. Add and Search started as separate tab ideas
 * and merged: both are "get me a new recipe", and splitting them asks the
 * user to know which kind of finding they are doing before they start
 * (ROADMAP #8). The bar renders only on the signed-in tab screens — a recipe
 * that is open gets the full viewport, because cooking does.
 */

import React from "react";

export type Tab = "find" | "recipes" | "settings";

interface Props {
  tab: Tab;
  onPick: (tab: Tab) => void;
}

const FindGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <circle cx="9.5" cy="9.5" r="5.75" stroke="currentColor" strokeWidth="1.8" />
    <path d="M14 14l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const RecipesGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <rect x="3" y="2.5" width="16" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
    <path d="M7 7.5h8M7 11h8M7 14.5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
const SettingsGlyph = () => (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
    <circle cx="11" cy="11" r="3" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M11 2.8v2.4M11 16.8v2.4M2.8 11h2.4M16.8 11h2.4M5.2 5.2l1.7 1.7M15.1 15.1l1.7 1.7M16.8 5.2l-1.7 1.7M6.9 15.1l-1.7 1.7"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);

const TABS: Array<{ id: Tab; label: string; Glyph: () => JSX.Element }> = [
  { id: "find", label: "Find", Glyph: FindGlyph },
  { id: "recipes", label: "My Recipes", Glyph: RecipesGlyph },
  { id: "settings", label: "Settings", Glyph: SettingsGlyph },
];

export default function BottomNav({ tab, onPick }: Props) {
  return (
    <nav className="rd-tabbar no-print" aria-label="Main">
      {TABS.map(({ id, label, Glyph }) => (
        <button
          key={id}
          className={`rd-tabbar-btn ${tab === id ? "is-on" : ""}`}
          aria-current={tab === id ? "page" : undefined}
          onClick={() => onPick(id)}
        >
          <Glyph />
          <span className="rd-tabbar-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
