---
name: Mobile OAuth bridge pattern (web-based provider auth from a native app)
description: A reusable way to get Google/Apple sign-in into an Expo app when the backend only has web-flavored OAuth routes, without adding native auth SDKs.
---

When a backend already has web OAuth (Google/Apple) and you need the same accounts usable from a native Expo app, without adding native auth SDKs (`expo-auth-session` provider setup, Apple's native Sign in with Apple, etc.), use this bridge instead of building parallel native auth:

1. Add mobile-flavored start routes on the existing backend (e.g. `GET /api/auth/mobile/google/start`) that redirect to a deep link back into the app. Default to a **fixed** custom-scheme link (e.g. `yourapp://auth`, from app.json's `scheme`) for a standalone/store build. But Expo Go does NOT own that custom scheme in development — `Linking.createURL('auth')` there instead returns a host-specific `exp://`/`exps://` link, different every dev session. So if the project is actually run/tested through Expo Go (not just a dev client build), the start route must accept a client-supplied `redirect_uri`, validate it server-side against an allowlist (exact fixed scheme, OR `exp:`/`exps:` with a host matching the project's own dev domain, AND only outside production), and store the validated value in the auth-state row to redirect to later — never trust an arbitrary client-supplied redirect outright, and never honor one in production regardless of what's asked.
2. The provider callback route tries the web auth-state flavor first, then falls back to the mobile flavor, so one callback endpoint serves both without duplicating provider config.
3. On success, the server mints a short-lived, single-use, in-memory handoff code and redirects to `yourapp://auth?code=...` — never put the real session token in a URL (URLs land in system browser history/logs).
4. Add one exchange endpoint, `POST /api/auth/mobile/exchange {code}` → `{token}`, and have the client store that token (SecureStore on native) and send it as `Authorization: Bearer <token>` from then on.
5. On the client, drive steps 1–4 with `expo-web-browser`'s `openAuthSessionAsync(startUrl, Linking.createURL('auth'))` — it opens an in-app browser tab and resolves directly when the deep link fires, no separate deep-link listener needed.

**Why:** avoids adding per-provider native SDKs to the mobile app and avoids building a second OAuth implementation — the mobile app reuses the exact same provider app registrations and web callback infrastructure.

**How to apply:** Reuse this shape whenever a project has web OAuth already and adds a native/Expo client that needs the same accounts. Verify early (a redirect_uri round-trip through the start route, checked against what actually got stored) rather than assuming the fixed-scheme deep link works under Expo Go — it silently doesn't. The full interactive round trip (a real provider consent screen redirecting back into the app) still needs verifying on a real device/build, since that part can't be driven from a shell.
