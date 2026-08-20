/**
 * scripts/run-tests.mjs — find the test files ourselves, then run node --test
 * on an explicit list.
 *
 * `"test": "node --test '{server,shared}/**\/*.test.ts'"` depended on NODE
 * expanding that pattern — the quotes stop the shell from touching it — and
 * Node only learned to glob --test arguments in v21. The Replit workspace
 * runs the nodejs-20 module, where the pattern is treated as a literal path
 * and the whole suite fails with "Could not find ...". That is also why a
 * hand-typed `find` one-liner kept working while npm test did not.
 *
 * So the enumeration happens here, in fs, where it cannot depend on the node
 * version's glob support or on which shell npm spawns. The child is
 * process.execPath, so the tests run on exactly the node that ran this file.
 *
 *   npm test                     the whole suite
 *   npm test -- shared/edits     only files whose path contains the string
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOTS = ["server", "shared"];

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

// Optional substring filters: `npm test -- urlKey` runs just that suite.
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
