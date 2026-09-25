#!/usr/bin/env node
/**
 * scripts/publish-update.mjs — publish an over-the-air update (EAS Update)
 * to the phones on one channel. THE way to run `eas update` for this app;
 * do not run it bare.
 *
 *   node scripts/publish-update.mjs --message "Fix the servings label"
 *   node scripts/publish-update.mjs --channel preview --message "..."
 *   node scripts/publish-update.mjs --message "..." --dry-run
 *
 * WHY THIS EXISTS. `eas build` takes EXPO_PUBLIC_DOMAIN from the build
 * profile in eas.json; `eas update` does NOT — it bakes in whatever the
 * shell running it has. In the Replit workspace that is the dev server, or
 * nothing, and `lib/api.ts` throws at launch when it is unset. So a bare
 * `eas update` from there would ship every installed app a bundle that talks
 * to the wrong server, or one that cannot start. This reads the domain from
 * the SAME eas.json profile the channel's builds were made with (the channel
 * is named after its profile), passes it explicitly, and refuses when there
 * is none.
 *
 * WHAT IT CANNOT SHIP. JavaScript and assets only. A native change — a new
 * package with native code, a config plugin, anything in app.json that ends
 * up in Info.plist — needs a new build, AND a bump of `expo.version` in the
 * same commit: the runtime version follows the app version
 * (`runtimeVersion.policy: appVersion`), and an update reaches exactly the
 * builds whose runtime matches. Forget the bump and an update written for
 * the new native code is offered to old binaries that lack it. README
 * "Over-the-air updates".
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? "";
};
const channel = flag("channel") ?? "production";
const message = flag("message");
const dryRun = args.includes("--dry-run");

const fail = (why) => {
  console.error(`publish-update: ${why}`);
  process.exit(1);
};

if (!message) fail('say what the update is: --message "…" (it is what the EAS dashboard lists).');

const eas = JSON.parse(readFileSync(join(root, "eas.json"), "utf8"));
const profile = Object.entries(eas.build ?? {}).find(([, p]) => p.channel === channel);
if (!profile) fail(`no build profile in eas.json uses channel "${channel}", so no installed app listens on it.`);
const [profileName, profileConfig] = profile;
const domain = profileConfig.env?.EXPO_PUBLIC_DOMAIN;
if (!domain)
  fail(`build profile "${profileName}" sets no EXPO_PUBLIC_DOMAIN, so an update could not know which server its builds talk to.`);

const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8")).expo;
console.log(`publish-update: channel ${channel} (profile "${profileName}")`);
console.log(`  server       ${domain}`);
console.log(`  reaches      builds of version ${app.version} (runtimeVersion follows the app version)`);
console.log(`  message      ${message}`);

// Newer eas-cli asks which EAS environment's hosted variables to load, and
// the answer for a channel is the environment of the same name — so it is
// passed rather than asked. (The server address never comes from there: it
// is set explicitly above, from the build profile.)
const EAS_ENVIRONMENTS = ["development", "preview", "production"];
const command = ["-y", "eas-cli@latest", "update", "--channel", channel, "--platform", "ios", "--message", message];
if (EAS_ENVIRONMENTS.includes(channel)) command.push("--environment", channel);
if (dryRun) {
  console.log(`  would run    EXPO_PUBLIC_DOMAIN=${domain} npx ${command.join(" ")}`);
  process.exit(0);
}

const result = spawnSync("npx", command, {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, EXPO_PUBLIC_DOMAIN: domain },
});
process.exit(result.status ?? 1);
