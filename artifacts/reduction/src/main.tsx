import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { initPush } from "./lib/push";

// At boot, not in the tap handler: Safari spends the user gesture on the
// first await, so the registration has to already exist by the time someone
// taps "Turn on notifications". See client/src/lib/push.ts.
void initPush();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
