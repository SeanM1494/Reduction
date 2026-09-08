---
name: No-accounts-yet gating
description: How "logged out" was approximated in an app with no auth system, and why that's a stopgap.
---

When a product has no accounts/sessions yet but needs a "logged out" vs "logged in" split (e.g. to show a public landing page to first-time visitors), the only available signal may be **application data state**, not identity — e.g. "this anonymous owner-key's library has 0 saved items."

**Why:** there is no real session/user concept to branch on. The user explicitly chose this over blocking the feature on building real accounts first, with the stated expectation that a proper accounts system will replace the check later.

**How to apply:**
- Gate on the data condition (e.g. `library.length === 0`), not on any invented "isLoggedIn" flag — don't let the naming imply auth exists.
- Guard against a flash: don't decide which view to show until the initial data fetch resolves (track a `loaded` boolean), or a returning user with real data flashes the "empty" view first.
- Flag to the user that this is a stopgap tied to the data shape, and will need revisiting once real accounts exist — don't let it quietly become load-bearing.
