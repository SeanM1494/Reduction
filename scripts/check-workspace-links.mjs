/**
 * scripts/check-workspace-links.mjs — is the workspace actually linked?
 *
 * Every `workspace:*` dependency in this repo is a symlink that `pnpm install`
 * creates under the depending package's node_modules. Nothing here works
 * without them — the api-server cannot find @workspace/db, the web app and
 * the mobile spike cannot find @workspace/recipe-model — and the failure is
 * a "Cannot find package" deep inside whatever ran first, which reads like a
 * bug in that file rather than an install that never finished.
 *
 * That is exactly what happened on Sep 9: Replit's post-merge hook ran
 * `pnpm install` with a 20-second timeout, the hook was killed before the
 * links were made, and the mobile app crashed on load naming a module that
 * existed. The container this was verified in had run its own install, so
 * the links were there and nothing reproduced. This script turns that into a
 * one-line answer with the fix in it, and runs before the test gate and the
 * dev server so the first message is the right one.
 *
 *   node scripts/check-workspace-links.mjs        exit 0 if linked, 1 if not
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "..", "..");

/** Every package directory the workspace file names (artifacts/*, lib/*). */
function workspacePackages() {
  const out = [];
  for (const group of ["artifacts", "lib"]) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const pkgJson = join(dir, name, "package.json");
      if (existsSync(pkgJson)) out.push({ dir: join(dir, name), pkg: JSON.parse(readFileSync(pkgJson, "utf8")) });
    }
  }
  return out;
}

export function checkWorkspaceLinks() {
  const missing = [];
  for (const { dir, pkg } of workspacePackages()) {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== "string" || !spec.startsWith("workspace:")) continue;
      const link = join(dir, "node_modules", name);
      let ok = false;
      try {
        // realpath follows the symlink; statSync confirms the target is a
        // directory that exists (a dangling link passes existsSync's
        // lstat-free check on some platforms and fails here).
        ok = statSync(realpathSync(link)).isDirectory();
      } catch {
        ok = false;
      }
      if (!ok) missing.push({ from: pkg.name ?? dir, dep: name, link });
    }
  }
  // The root devDependencies matter too: `node --import tsx` in the test
  // runner resolves tsx from the root node_modules.
  if (!existsSync(join(root, "node_modules", "tsx", "package.json"))) {
    missing.push({ from: "(root)", dep: "tsx", link: join(root, "node_modules", "tsx") });
  }
  return missing;
}

export function reportMissing(missing) {
  if (!missing.length) return;
  console.error("The workspace is not linked. Missing:");
  for (const m of missing) console.error(`  ${m.from} → ${m.dep}  (${m.link})`);
  console.error(
    "\nRun `pnpm install --frozen-lockfile` from the repo root and try again.\n" +
      "On Replit this usually means the post-merge hook was cut off before it finished linking."
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = checkWorkspaceLinks();
  reportMissing(missing);
  process.exit(missing.length ? 1 : 0);
}
