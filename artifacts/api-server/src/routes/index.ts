import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { authRouter } from "./auth";
import { recipesRouter } from "./recipes";
import { libraryRouter } from "./library";
import { trialRouter } from "./trial";
import { pushRouter, timersRouter } from "./push";
import { billingRouter } from "./billing";
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
// One operator, one lookup, behind a shared secret. 404s when ADMIN_SECRET is
// unset — see the note at the top of routes/admin.ts about why this is not an
// authentication path.
router.use("/admin", adminRouter);

export default router;
