/**
 * client/src/components/ThemeToggle.tsx — nav control for switching between
 * the light, dark and colorblind-safe themes. Purely a state switch; all the
 * actual recoloring lives in index.css, driven by the data-theme /
 * data-colorblind attributes useTheme sets on <html>.
 */

import React from "react";
import type { ThemeMode } from "../lib/theme";

const OPTIONS: Array<{ mode: ThemeMode; label: string; title: string }> = [
  { mode: "light", label: "Light", title: "Light mode" },
  { mode: "dark", label: "Dark", title: "Dark mode" },
  { mode: "colorblind", label: "Colorblind", title: "Colorblind-safe mode" },
];

interface Props {
  mode: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}

export default function ThemeToggle({ mode, onChange }: Props) {
  return (
    <div className="rd-theme-toggle" role="group" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.mode}
          type="button"
          className={`rd-theme-btn ${mode === o.mode ? "is-on" : ""}`}
          aria-pressed={mode === o.mode}
          title={o.title}
          onClick={() => onChange(o.mode)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
