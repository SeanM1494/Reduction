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
import { trialRouter } from "./routes/trial";
import { pushRouter, timersRouter } from "./routes/push";
import { billingRouter, stripeWebhookHandler } from "./routes/billing";
import { adminRouter } from "./routes/admin";
import { attachSession } from "./middleware/session";
import { startSessionSweep } from "./lib/sessions";
import { startTimerDispatch } from "./lib/timerDispatch";
import { cleanupSeedRecipes } from "./cleanupSeed";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === "production";
const PORT = isProd ? Number(process.env.PORT) || 5000 : 3001;

const app = express();

/**
 * THE STRIPE WEBHOOK IS MOUNTED BEFORE express.json(), AND HAS TO BE.
 *
 * Stripe signs the RAW request body. Once express.json() has parsed and
 * re-serialised it, the bytes no longer match the signature and
 * constructEvent fails on every event, permanently, with an error that does
 * not say why. Moving this line below the json() call is a one-character
 * change that silently breaks all billing.
 */
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
);

// Base64 images arrive inline, so the default 100kb limit is far too small.
app.use(express.json({ limit: "12mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// Before the routers: every request gets to know whether it is signed in.
// Nothing is rejected here — see middleware/session.ts.
app.use(attachSession);

app.use("/api/auth", authRouter);
app.use("/api/recipes", recipesRouter);
app.use("/api/library", libraryRouter);
app.use("/api/trial", trialRouter);
app.use("/api/push", pushRouter);
// The dispatch trigger. See server/lib/timerDispatch.ts: the work is a plain
// function, and this route is only one of the three ways to reach it.
app.use("/api/timers", timersRouter);
app.use("/api/billing", billingRouter);
// One operator, one lookup, behind a shared secret. 404s when ADMIN_SECRET is
// unset — see the note at the top of routes/admin.ts about why this is not an
// authentication path.
app.use("/api/admin", adminRouter);

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
// Fires timer notifications only while this process happens to be alive. On
// Autoscale that means "while the app is in use", which is a bandaid and is
// documented as one — see server/lib/timerDispatch.ts and ROADMAP.
startTimerDispatch();
