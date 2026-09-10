---
name: Expo dev server missing eas.projectId blocks signed manifests
description: Replit auto-signs the Expo CLI into a session; without extra.eas.projectId in app.json, clients that require a signed manifest fail — likely root cause for both the "signed in to Expo Go but not Expo CLI" error and in-app iOS Simulator crash-on-launch.
---

The mobile dev server script signs the Expo CLI into a Replit-managed session automatically (`create-launch login --session $REPLIT_EXPO_SESSION_SECRET`). When `app.json` has no `extra.eas.projectId`, Expo itself prints a banner on every dev-server start explaining that a signed-in CLI cannot serve a signed manifest without an EAS project id, and recommends opening Expo Go **signed out**.

**Why this matters:** this session-signing gap is the most plausible shared root cause for two separate-looking symptoms:
1. Physical-device Expo Go reporting "You're signed in to Expo Go... but not signed in to Expo CLI" (already documented as a known Expo Go 57 issue in the `expo` skill).
2. The Replit in-app iOS Simulator opening and then crashing/closing immediately, before any screen renders — this simulator likely goes through the same signed-manifest path but has no fallback UI, so it just exits instead of showing an explanatory message.

Ruled out before landing on this: dependency version drift (`expo install --check` / `expo-doctor` both clean), known React Native crash pitfalls (uuid package, pinned expo-crypto/react-native-maps versions, native hardware APIs called eagerly at startup) — none were present in this codebase.

**How to apply:** Do NOT try to fix this by adding `extra.eas.projectId`, running `eas init`, or any other EAS CLI command — the `expo` skill explicitly forbids EAS CLI commands (Replit's Expo Launch owns EAS project setup) and this is described as a platform session issue, not a project bug. If both the Expo Go sign-in error and an immediate in-app-simulator crash are reported together, treat it as this same known limitation rather than continuing to hunt for an app-code bug in either channel.
