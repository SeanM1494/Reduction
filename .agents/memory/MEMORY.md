# Memory Index

- [TS composite package dist shadowing](ts-composite-dist-shadowing.md) — a workspace package's stale `dist/*.d.ts` can shadow live source exports for referencing projects even when `exports` points at source.
- [pnpm peer-dependency duplication](pnpm-peer-dependency-duplication.md) — divergent devDependency versions (e.g. `@types/pg`) across workspace packages sharing a peer-dependent lib can silently duplicate that lib and break structural typing.
- [Multi-artifact copy script relative-path fixups](multi-artifact-copy-relative-paths.md) — the migrate-to-multi-artifact copy scripts don't fully fix nested relative imports; verify by depth and check inline `import("...")` type-only references separately.
- [Expo Go native-library restriction](expo-no-native-libraries.md) — can't add native modules (e.g. expo-notifications) mid-task without an EAS dev build; ship a foreground/JS-only fallback and file the rest as a follow-up.
- [Mobile OAuth bridge pattern](mobile-oauth-bridge-pattern.md) — reuse existing web OAuth via fixed-deep-link mobile start routes + one-time handoff code + `openAuthSessionAsync`, instead of native auth SDKs.
- [expo-secure-store fails on web preview](expo-secure-store-web-preview.md) — its web shim is missing `getValueWithKeyAsync` in this SDK; wrap storage so web falls back to AsyncStorage.
- [Expo missing eas.projectId blocks signed manifests](expo-go-eas-projectid-signing.md) — likely shared root cause of Expo Go sign-in errors AND in-app iOS Simulator crash-on-launch; don't chase it as an app-code bug.
