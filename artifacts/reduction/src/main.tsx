import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initPush } from "./lib/push";
import { ErrorBoundary } from "./components/error-boundary";
import { installCrashReporter, reportCrash } from "./lib/crashReport";

// At boot, not in the tap handler: Safari spends the user gesture on the
// first await, so the registration has to already exist by the time someone
// taps "Turn on notifications". See client/src/lib/push.ts.
void initPush();

// Crash reports (lib/crashReport.ts): scrubbed, anonymous, production only.
installCrashReporter();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary onError={(error, stack) => reportCrash("render", error, stack)}>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
