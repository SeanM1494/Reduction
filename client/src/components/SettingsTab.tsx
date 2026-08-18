/**
 * client/src/components/SettingsTab.tsx — account and appearance.
 *
 * These controls lived in the top nav, which taxed every screen with them to
 * make them reachable from any screen. A Settings tab is where a phone user
 * already expects them, and it frees the nav to be a brand line.
 */

import React from "react";
import ThemeToggle from "./ThemeToggle";
import type { ThemeMode } from "../lib/theme";
import type { SessionUser } from "../lib/session";

interface Props {
  user: SessionUser;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onSignOut: () => void;
  recipeCount: number;
}

export default function SettingsTab({
  user,
  themeMode,
  onThemeChange,
  onSignOut,
  recipeCount,
}: Props) {
  return (
    <div className="rd-settings">
      <div className="rd-settings-card">
        <h2 className="rd-settings-heading">Account</h2>
        <p className="rd-settings-line">
          <strong>{user.displayName || "Signed in"}</strong>
          {user.email ? <span className="rd-settings-sub"> {user.email}</span> : null}
        </p>
        <p className="rd-settings-line rd-settings-sub">
          {recipeCount} {recipeCount === 1 ? "recipe" : "recipes"} in your library
        </p>
        <button className="rd-btn rd-settings-signout" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <div className="rd-settings-card">
        <h2 className="rd-settings-heading">Appearance</h2>
        <ThemeToggle mode={themeMode} onChange={onThemeChange} />
      </div>
    </div>
  );
}
