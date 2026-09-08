---
name: expo-secure-store fails on web preview
description: expo-secure-store crashes with "getValueWithKeyAsync is not a function" when an Expo app runs on web (react-native-web) in this SDK version; how to fix it.
---

`expo-secure-store`'s web shim does not implement `getValueWithKeyAsync` in the SDK version used in this environment, so any `SecureStore.getItemAsync`/`setItemAsync`/`deleteItemAsync` call throws immediately when the app is rendered via react-native-web — which is how the Replit preview pane renders Expo apps by default (`expo start` serves a web build alongside native).

**Why:** the Replit preview screenshots and browser-based checks hit the web build, not a native simulator, so this crash blocks all visual verification of any screen behind an auth/token gate.

**How to apply:** never call `expo-secure-store` directly from shared code. Wrap it in a small helper (`getSecureItem`/`setSecureItem`/`deleteSecureItem`) that branches on `Platform.OS === 'web'` and falls back to `@react-native-async-storage/async-storage` (or another web-safe store) on web, keeping real SecureStore for native. Apply this to any Expo app that stores tokens/secrets and expects to be previewed on Replit.
