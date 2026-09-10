/**
 * scripts/expo-session.mjs — sign Expo CLI in as Replit's Expo account, LOUDLY.
 *
 * WHY THIS EXISTS. Expo Go on the phone is signed in (Replit's QR flow signs
 * it in as a `replit-private-…` account). A signed-in Expo Go sends
 * `expo-expect-signature` with every manifest request, and the dev server can
 * only satisfy that by fetching a development certificate for the account it
 * is logged in as. Not logged in, no certificate, and Expo Go shows:
 *
 *   "You're signed in to Expo Go as replit-private-…, but not signed in to
 *    Expo CLI."
 *
 * — before a single line of the app runs. The scaffold's dev script handled
 * the login with `create-launch login --session "$SECRET" || true`: a network
 * call to Expo's API whose failure was swallowed, so an expired secret, an
 * unset variable, or a missing binary all produced a server that started
 * happily and a phone that could not open it, with nothing in the log.
 *
 * This writes the session the way Expo CLI itself stores it (state.json's
 * `auth.sessionSecret` — the same thing create-launch writes after its user
 * lookup), which needs no network, then asks `expo whoami` and prints the
 * answer so the Metro log shows who the server is, and says in plain words
 * what to do when it is nobody. It never blocks the server from starting:
 * the web preview does not need the login.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const secret = process.env.REPLIT_EXPO_SESSION_SECRET?.trim();

const warn = (lines) => {
  console.error("\n" + "=".repeat(72));
  for (const l of lines) console.error(l);
  console.error("=".repeat(72) + "\n");
};

function expoHome() {
  // Mirrors @expo/cli's getExpoHomeDirectory(): the shell-only escape hatch
  // first, then the staging/local variants, then ~/.expo.
  const unsafe = process.env.__UNSAFE_EXPO_HOME_DIRECTORY?.trim();
  if (unsafe) return unsafe;
  const truthy = (v) => /^(1|true|yes)$/i.test(v ?? "");
  if (truthy(process.env.EXPO_STAGING)) return path.join(os.homedir(), ".expo-staging");
  if (truthy(process.env.EXPO_LOCAL)) return path.join(os.homedir(), ".expo-local");
  return path.join(os.homedir(), ".expo");
}

if (!secret) {
  warn([
    "REPLIT_EXPO_SESSION_SECRET is not set, so Expo CLI is starting SIGNED OUT.",
    "A phone whose Expo Go is signed in (Replit's QR flow signs it in) will",
    "refuse this server with \"signed in to Expo Go … but not signed in to Expo CLI\".",
    "Either start the app from Replit's mobile workflow, which sets the secret,",
    "or sign out of Expo Go on the phone (Profile → Sign out) and scan again.",
  ]);
  process.exit(0);
}

// The signature Expo Go asks for is a development certificate issued for an
// EAS project id (`extra.eas.projectId` in app.json). Without one, the CLI
// cannot sign the manifest however well it is logged in — the codesigning
// path returns null with a debug-level note nobody sees — and a signed-in
// Expo Go refuses the server just the same. Say so.
try {
  const appJson = JSON.parse(fs.readFileSync(new URL("../app.json", import.meta.url), "utf8"));
  if (!appJson?.expo?.extra?.eas?.projectId) {
    warn([
      "app.json has no extra.eas.projectId. A signed-in Expo Go needs the dev",
      "server to SIGN its manifest with a certificate issued for an EAS project,",
      "so even a logged-in Expo CLI cannot serve it without one. Until a project",
      "id exists, open the app with Expo Go SIGNED OUT (Profile → Sign out).",
    ]);
  }
} catch {
  /* no app.json readable — the CLI will complain louder than this would */
}

const dir = expoHome();
const file = path.join(dir, "state.json");
let state = {};
try {
  state = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  state = {};
}
const prev = state.auth && typeof state.auth === "object" ? state.auth : {};
const sameSecret = prev.sessionSecret === secret;
state.auth = {
  // Keep the cached identity when the secret has not changed; drop it when it
  // has, so a stale username is never shown for a new session.
  ...(sameSecret ? prev : {}),
  sessionSecret: secret,
  currentConnection: "Username-Password-Authentication",
};
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
fs.chmodSync(file, 0o600);

// Validate by asking the CLI who it is. This is the one network call, and it
// is diagnostic rather than load-bearing: the session is already written.
const who = spawnSync("npx", ["expo", "whoami"], { encoding: "utf8", timeout: 30_000 });
const lines = `${who.stdout ?? ""}${who.stderr ?? ""}`
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !/Ignoring extra certs/.test(l) && !/^at /.test(l));
// The one line that says something: "Not logged in", a username, or the
// error Expo's API answered with — never a stack frame.
const said = lines.find((l) => /not logged in|error|responded|failed/i.test(l)) ?? lines[0] ?? "nothing";
if (who.status === 0 && !/not logged in/i.test(said)) {
  console.log(`[expo-session] Expo CLI is signed in as: ${said}`);
} else {
  warn([
    "Expo CLI could not confirm the session (`expo whoami` says: " + said + ").",
    "REPLIT_EXPO_SESSION_SECRET is set but Expo did not accept it — most often it",
    "has EXPIRED. A signed-in Expo Go will refuse this server. To recover:",
    "  1. Reopen Replit's mobile preview pane so it issues a fresh secret, and",
    "     restart this workflow; or",
    "  2. Sign out of Expo Go on the phone (Profile → Sign out) and scan again —",
    "     a signed-out Expo Go accepts an unsigned dev server.",
    "The server is starting anyway; the web preview does not need the login.",
  ]);
}
