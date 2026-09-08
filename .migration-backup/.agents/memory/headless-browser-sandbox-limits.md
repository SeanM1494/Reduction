---
name: Headless browser unavailable in this sandbox
description: Playwright/Chromium fails to launch in the Replit workspace sandbox due to missing system shared libraries.
---

Installing Playwright and its Chromium browser (`npx playwright install chromium`) succeeds, but launching it fails at runtime: `error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file`. The sandbox's NixOS environment doesn't have the GTK/glib/nss dependency stack Chromium needs, and installing it ad hoc (via `nix-shell -p ...`) is fragile and not worth pursuing for a one-off check.

**Why:** tried this specifically to screenshot the app at a phone viewport width (the built-in Screenshot tool has no viewport-size control for `appPreview`). It is not fixable by just installing the npm package.

**How to apply:**
- Don't reach for Playwright/Puppeteer in this sandbox for viewport-specific or interaction-heavy checks — it will not launch.
- For layout questions at a specific viewport (e.g. "does this need horizontal scroll on mobile?"), reason from the actual CSS breakpoints/min-widths and the component's rendering logic instead, or use the Screenshot tool's default desktop viewport plus manual inspection of responsive CSS rules.
- Clean up fully if you try anyway: `npm install --no-save` still touches `package.json`/`package-lock.json` — revert with `git checkout -- package.json package-lock.json` and remove the installed packages/browser cache.
