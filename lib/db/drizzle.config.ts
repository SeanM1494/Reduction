import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

/**
 * REFUSE TO PUSH AT A NON-LOCAL DATABASE.
 *
 * In the Replit workspace, DATABASE_URL is production — and drizzle-kit push
 * diffs the live schema against schema.ts and applies whatever it takes to
 * make them match, including DROPs. That combination already fired once: a
 * re-armed post-merge hook auto-pushed a schema change to production on
 * Sep 8 with nobody running anything (auth_states.redirect_uri; benign, but
 * only by luck). Same posture as server testdb.ts: local means loopback, and
 * anything else needs the override set deliberately, in the same shell, by a
 * person who has just taken a snapshot.
 */
const dbUrl = new URL(process.env.DATABASE_URL);
const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(dbUrl.hostname);
if (!isLocal && process.env.ALLOW_REMOTE_DB_PUSH !== "1") {
  throw new Error(
    `Refusing to run drizzle-kit against non-local database host "${dbUrl.hostname}". ` +
      "Production schema changes are hand-run DDL (see CLAUDE.md). " +
      "If you really mean it, set ALLOW_REMOTE_DB_PUSH=1."
  );
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
