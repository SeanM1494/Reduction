import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { stripeWebhookHandler } from "./routes/billing";
import { attachSession } from "./middleware/session";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

/**
 * THE STRIPE WEBHOOK IS MOUNTED BEFORE express.json(), AND HAS TO BE.
 *
 * Stripe signs the RAW request body. Once express.json() has parsed and
 * re-serialised it, the bytes no longer match the signature and
 * constructEvent fails on every event, permanently, with an error that does
 * not say why. Moving this line below the json() call is a one-character
 * change that silently breaks all billing. (Ported from the legacy
 * server/index.ts — see that file's history for the original note.)
 */
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);

// Base64 images arrive inline, so the default 100kb limit is far too small.
app.use(express.json({ limit: "12mb" }));
// Apple's Sign in with Apple callback uses response_mode=form_post.
// NO global urlencoded parser, deliberately. The Apple sign-in callback is
// the one route in this app that takes a form body, and it mounts its own
// parser (see routes/auth.ts) — a global one would start accepting form
// bodies on every route, a CSRF surface nothing else needs. The workspace
// migration added one here; removed, restoring the documented rule.

// Before the routers: every request gets to know whether it is signed in.
// Nothing is rejected here — see middleware/session.ts.
app.use(attachSession);

app.use("/api", router);

/**
 * IN PRODUCTION, THIS PROCESS IS THE WHOLE SITE. The web artifact builds to
 * artifacts/reduction/dist/public, and serving it from here — same process,
 * same port — is what lets the deployment be one ordinary Autoscale service
 * with one run command, instead of depending on platform-side routing that
 * lives in no file this repo controls. (That dependency is how the site
 * became unpublishable: the migration left /api-only serving here and the
 * frontend's routing in Replit workspace state that a republish could not
 * see.) Same serving model as the pre-migration server/index.ts.
 */
if (process.env.NODE_ENV === "production") {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/index.mjs -> ../../reduction/dist/public
  const clientDir = path.resolve(here, "../../reduction/dist/public");
  if (!fs.existsSync(clientDir)) {
    logger.error({ clientDir }, "dist/public missing — build artifacts/reduction first");
  }
  app.use(express.static(clientDir));
  // SPA fallback as plain middleware, not app.get("*") — Express 5's router
  // (path-to-regexp v8) rejects the bare-star pattern outright.
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDir, "index.html"));
  });
}

export default app;
