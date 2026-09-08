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

const ROOTS = ["artifacts/api-server/src", "lib/recipe-model/src"];

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
