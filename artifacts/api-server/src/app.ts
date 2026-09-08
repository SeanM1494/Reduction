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
app.use(express.urlencoded({ extended: true }));

// Before the routers: every request gets to know whether it is signed in.
// Nothing is rejected here — see middleware/session.ts.
app.use(attachSession);

app.use("/api", router);

export default app;
