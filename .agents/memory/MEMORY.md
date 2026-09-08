# Memory Index

- [TS composite package dist shadowing](ts-composite-dist-shadowing.md) — a workspace package's stale `dist/*.d.ts` can shadow live source exports for referencing projects even when `exports` points at source.
- [pnpm peer-dependency duplication](pnpm-peer-dependency-duplication.md) — divergent devDependency versions (e.g. `@types/pg`) across workspace packages sharing a peer-dependent lib can silently duplicate that lib and break structural typing.
- [Multi-artifact copy script relative-path fixups](multi-artifact-copy-relative-paths.md) — the migrate-to-multi-artifact copy scripts don't fully fix nested relative imports; verify by depth and check inline `import("...")` type-only references separately.
