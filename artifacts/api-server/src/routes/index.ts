import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { authRouter } from "./auth";
import { recipesRouter } from "./recipes";
import { libraryRouter } from "./library";
import { trialRouter } from "./trial";
import { pushRouter, timersRouter } from "./push";
import { billingRouter } from "./billing";
import { appleBillingRouter } from "./billingApple";
import { adminRouter } from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.get("/health", (_req, res) => res.json({ ok: true }));

router.use("/auth", authRouter);
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
