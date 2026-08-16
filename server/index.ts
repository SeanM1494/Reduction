/**
 * server/index.ts — Express entry point.
 *
 * Dev:  Vite serves the client on 5000 and proxies /api here on 3001.
 * Prod: this process serves the built client from dist/public on $PORT.
 */

import express from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { recipesRouter } from "./routes/recipes";
import { libraryRouter } from "./routes/library";
import { authRouter } from "./routes/auth";
import { attachSession } from "./middleware/session";
import { startSessionSweep } from "./lib/sessions";
import { cleanupSeedRecipes } from "./cleanupSeed";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const PORT = isProd ? Number(process.env.PORT) || 5000 : 3001;

const app = express();

// Base64 images arrive inline, so the default 100kb limit is far too small.
app.use(express.json({ limit: "12mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Before the routers: every request gets to know whether it is signed in.
// Nothing is rejected here — see middleware/session.ts.
app.use(attachSession);

app.use("/api/auth", authRouter);
app.use("/api/recipes", recipesRouter);
app.use("/api/library", libraryRouter);

if (isProd) {
  const clientDir = path.resolve(__dirname, "../dist/public");
  if (!fs.existsSync(clientDir)) {
    console.error("dist/public is missing. Run `npm run build` first.");
  }
  app.use(express.static(clientDir));
  // SPA fallback — anything that is not /api returns index.html.
  app.get("*", (_req, res) => res.sendFile(path.join(clientDir, "index.html")));
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    isProd
      ? `Reduction listening on ${PORT}`
      : `API listening on ${PORT} (client runs on 5000)`
  );
});

cleanupSeedRecipes();
startSessionSweep();
