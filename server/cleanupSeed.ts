/**
 * server/cleanupSeed.ts — one-time removal of the retired cheesecake seed.
 *
 * The app used to bootstrap every empty library with a hardcoded
 * "Plain New York Style Cheesecake" recipe at the literal id "seed"
 * (see shared/schema.ts's old comment / git history). That seeding was
 * removed in favor of a public demo + landing page that never touches the
 * database, but rows it already wrote — in dev and, once this ships, in
 * production — needed to go too.
 *
 * This runs as a guarded startup check rather than a one-off script:
 * production's database is not reachable with a direct write from the
 * dev workspace (only read-only queries are), so shipping the cleanup as
 * app code that runs on boot is what actually reaches production, the
 * next time this deploys. It's cheap and idempotent — a no-op once the
 * rows are gone — so leaving it running on every boot is harmless.
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { recipes } from "../shared/schema";

export async function cleanupSeedRecipes(): Promise<void> {
  try {
    const db = getDb();
    const removed = await db
      .delete(recipes)
      .where(eq(recipes.id, "seed"))
      .returning({ id: recipes.id });
    if (removed.length) {
      console.log(`[cleanupSeed] removed ${removed.length} leftover seed recipe row(s)`);
    }
  } catch (e) {
    // Never block server startup on this — a missing/unreachable database
    // will already fail loudly for every real route.
    console.error("[cleanupSeed] skipped:", (e as Error).message);
  }
}
