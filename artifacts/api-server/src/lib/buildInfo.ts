/**
 * lib/buildInfo.ts — which commit this process was built from.
 *
 * WHY. A phone's sign-in touches three servers: the app talks to whichever
 * one EXPO_PUBLIC_DOMAIN names (the workspace dev server, in development),
 * Google calls back to PUBLIC_BASE_URL (the deployment), and the app redeems
 * its code on the first again. A fix that has to be on BOTH — the
 * database-backed handoff was one — is invisible until both are republished,
 * and "what commit is production running" had no answer short of guessing
 * from timestamps. `GET /api/health` now says, and the auth log lines carry
 * it, so a trace across two deployments names the one that is behind.
 *
 * build.mjs defines BUILD_COMMIT_INJECTED from `git rev-parse` at build
 * time; under tsx (tests, the dev script) it is undefined and the env
 * fallback applies, then "dev".
 */
declare const BUILD_COMMIT_INJECTED: string | undefined;

export const BUILD_COMMIT: string =
  (typeof BUILD_COMMIT_INJECTED === "string" && BUILD_COMMIT_INJECTED) ||
  process.env.BUILD_COMMIT?.trim() ||
  "dev";
