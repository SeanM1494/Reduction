import { BUILD_COMMIT } from "./lib/buildInfo";
import app from "./app";
import { logger } from "./lib/logger";
import { startSessionSweep } from "./lib/sessions";
import { startTimerDispatch } from "./lib/timerDispatch";
import { cleanupSeedRecipes } from "./cleanupSeed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port, commit: BUILD_COMMIT }, "Server listening");
});

void cleanupSeedRecipes();
startSessionSweep();
// Fires timer notifications only while this process happens to be alive. On
// an autoscaled deployment that means "while the app is in use", which is a
// bandaid and is documented as one — see lib/timerDispatch.ts.
startTimerDispatch();
