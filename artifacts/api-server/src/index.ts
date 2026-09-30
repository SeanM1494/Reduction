import { BUILD_COMMIT } from "./lib/buildInfo";
import app from "./app";
import { logger } from "./lib/logger";
import { startSessionSweep } from "./lib/sessions";
import { startTimerDispatch } from "./lib/timerDispatch";
import { logSchemaAtBoot } from "./lib/schemaCheck";
import { cleanupSeedRecipes } from "./cleanupSeed";
import { edgeConfig } from "./lib/clientAddress";

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
// Hand-run DDL the code needs and the database lacks, named at boot.
void logSchemaAtBoot();
// Which load-balancer addresses the per-client limits anchor on. A refused
// TRUSTED_EDGE_IPS warns here, once (lib/clientAddress.ts), and leaves the
// shared bucket; unset is said too, because it is the same bucket.
{
  const edges = edgeConfig();
  if (!edges.problem)
    logger.info(
      { trustedEdges: edges.ips.size },
      edges.ips.size ? "Client keys anchor on TRUSTED_EDGE_IPS" : "TRUSTED_EDGE_IPS unset: every client shares one limit bucket"
    );
}
