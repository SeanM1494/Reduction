/**
 * scripts/run-tests.mjs — find the test files ourselves, then run node --test
 * on an explicit list.
 *
 * Revived from the pre-migration tree (the workspace migration dropped the
 * test gate entirely). The original reason stands even on newer Node: the
 * enumeration happens in fs, where it cannot depend on a node version's glob
 * support or on which shell pnpm spawns. The child is process.execPath, so
 * tests run on exactly the node that ran this file.
 *
 *   pnpm test                     the whole suite
 *   pnpm test -- urlKey           only files whose path contains the string
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkWorkspaceLinks, reportMissing } from "./check-workspace-links.mjs";

// Before anything else: an unlinked workspace fails inside the first test
// file with "Cannot find package '@workspace/db'", which reads as a bug in
// that file. Say what it actually is, and what fixes it.
{
  const missing = checkWorkspaceLinks();
  if (missing.length) {
    reportMissing(missing);
    process.exit(1);
  }
}

// reduction-mobile/components/diagram is PURE geometry (no react-native
// import), which is what lets it run under plain node here. Anything in the
// mobile artifact that imports react-native cannot join this list.
const ROOTS = [
  "artifacts/api-server/src",
  "lib/recipe-model/src",
  "artifacts/reduction-mobile/components/diagram",
];

function testFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...testFiles(path));
    } else if (entry.name.endsWith(".test.ts")) {
      out.push(path);
    }
  }
  return out;
}

let files = ROOTS.flatMap((r) => testFiles(r)).sort();

const filters = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (filters.length) {
  files = files.filter((f) => filters.some((needle) => f.includes(needle)));
  if (!files.length) {
    console.error(`No test files match: ${filters.join(", ")}`);
    process.exit(1);
  }
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" }
);
process.exit(result.status ?? 1);
