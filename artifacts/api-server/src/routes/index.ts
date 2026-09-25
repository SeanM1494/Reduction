import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { schemaForHealth } from "../lib/schemaCheck";
import { BUILD_COMMIT } from "../lib/buildInfo";
import { authRouter } from "./auth";
import { recipesRouter } from "./recipes";
import { libraryRouter } from "./library";
import { trialRouter } from "./trial";
import { pushRouter, timersRouter } from "./push";
import { billingRouter } from "./billing";
import { appleBillingRouter } from "./billingApple";
import { adminRouter } from "./admin";
import { accountRouter } from "./account";

import { EXTRACTION_MAX_TOKENS, extractionEffort } from "../lib/extractionConfig";

const router: IRouter = Router();

router.use(healthRouter);
// `commit` is the one fact that tells two deployments apart from outside —
// see lib/buildInfo.ts for the sign-in trace that needed it.
// `schema` names any hand-run DDL this build needs and the database lacks
// (lib/schemaCheck.ts). `ok` stays about the process, so a platform health
// probe is never failed by a missing column it can do nothing about.
// `extraction` is what the model is being asked to do, so a before/after
// comparison can confirm which side a deployment is on (extractionConfig.ts).
router.get("/health", async (_req, res) =>
  res.json({
    ok: true,
    commit: BUILD_COMMIT,
    schema: await schemaForHealth(),
    extraction: { effort: extractionEffort() ?? "default", maxTokens: EXTRACTION_MAX_TOKENS },
  })
);

router.use("/auth", authRouter);
router.use("/account", accountRouter);
router.use("/recipes", recipesRouter);
router.use("/library", libraryRouter);
router.use("/trial", trialRouter);
router.use("/push", pushRouter);
// The dispatch trigger. See lib/timerDispatch.ts: the work is a plain
// function, and this route is only one of the ways to reach it.
router.use("/timers", timersRouter);
router.use("/billing", billingRouter);
// The App Store's two entry points (the app's verify call and Apple's
// notifications). Plain JSON bodies — the proof is the JWS inside, not a
// body signature — so unlike the Stripe webhook this mounts after
// express.json() like everything else.
router.use("/billing/apple", appleBillingRouter);
// One operator, one lookup, behind a shared secret. 404s when ADMIN_SECRET is
// unset — see the note at the top of routes/admin.ts about why this is not an
// authentication path.
router.use("/admin", adminRouter);

export default router;
