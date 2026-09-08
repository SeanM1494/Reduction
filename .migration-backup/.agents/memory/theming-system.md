---
name: Theming system (light/dark/colorblind)
description: How Logic Cooking's theme switching is architected — data attributes, token cascade, colorblind overlay, and pre-paint flash prevention.
---

The app has a light/dark/colorblind theme system driven by two attributes on
`document.documentElement`: `data-theme` (`"light"|"dark"` base palette) and
`data-colorblind="true"` (an optional overlay flag), rather than treating
colorblind as a 4th independent base. All themeable colors are CSS custom
properties in `client/src/index.css`, cascaded across `:root`,
`:root[data-theme="dark"]`, `:root[data-colorblind="true"]`, and
`:root[data-theme="dark"][data-colorblind="true"]` blocks.

**Why this shape:** the spec required colorblind mode to still respect a
light-or-dark base rather than being its own fixed palette, so the colorblind
block only overrides the warm/cool accent tokens (not backgrounds/text),
letting it compose with either base via CSS cascade instead of JS branching.

**Persisted preference** is one of exactly 3 values (`light|dark|colorblind`)
in localStorage key `logic-cooking:theme:v1`, read/written via
`client/src/lib/theme.ts`. If never set, the app follows live
`prefers-color-scheme` via a `matchMedia` listener in
`client/src/hooks/useTheme.ts` (not frozen at first load — changing OS theme
updates the app live when no explicit choice was made). Colorblind mode's
light/dark *base* also keeps following the system preference live; only an
explicit "light"/"dark" choice is fixed.

**Flash-of-wrong-theme prevention:** `index.html` has an inline blocking
`<script>` in `<head>` that duplicates the same read-localStorage +
matchMedia logic synchronously before first paint, since React hasn't
hydrated yet. If the theme-detection logic in `theme.ts`/`useTheme.ts` ever
changes, the inline script in `index.html` must be updated to match or a
flash will reappear.

**Non-color state cue:** colorblind mode adds a small triangle shape
(`.rd-mark` / `.rd-fin-mark`) next to "ready" diagram cells/finish-strip
items, shown only when `data-colorblind="true"`, mirroring the checkmark
already used for "done" — so ready-vs-done doesn't rely on hue alone.

**Derived tint shading:** `depthTint()` in `Diagram.tsx` (op-column shading)
uses `color-mix(in srgb, var(--card) X%, var(--ink) Y%)` instead of a
fixed-hue HSL formula, so shading auto-adapts to any theme without the JS
needing to know which theme is active. Any future gradient/tint logic in
this app should follow the same pattern rather than hardcoding hues.
