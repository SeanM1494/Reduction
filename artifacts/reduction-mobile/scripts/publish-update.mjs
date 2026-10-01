#!/usr/bin/env node
/**
 * scripts/publish-update.mjs — publish an over-the-air update (EAS Update)
 * to the phones on one channel. THE way to run `eas update` for this app;
 * do not run it bare.
 *
 *   node scripts/publish-update.mjs --message "Fix the servings label"
 *   node scripts/publish-update.mjs --channel preview --message "..."
 *   node scripts/publish-update.mjs --message "..." --dry-run
 *   node scripts/publish-update.mjs --promote <group id> [--dry-run]
 *
 * THE FLOW (Oct 1): publish to PREVIEW, run it on the owner's phone (the
 * testing sheet's "Updates from: preview"), then PROMOTE that exact bundle
 * to production with --promote. Promoting is `eas update:republish --group
 * <id> --destination-channel production` — the same bytes, not a rebuild —
 * and it is refused unless every update in the group is on branch preview
 * and its commit is on main (or only Replit's empty "Published your App"
 * commits sit on top of main). scripts/publishGuards.mjs holds the checks,
 * tested in lib/publishGuards.test.ts.
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
import { classifyCommit, parseUpdateView, promoteProblems, promotedMessage } from "./publishGuards.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? "";
};
const channel = flag("channel") ?? "production";
const message = flag("message");
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");

const fail = (why) => {
  console.error(`publish-update: ${why}`);
  process.exit(1);
};

// ---- --promote: preview's tested bundle, copied to production. ----
const promote = flag("promote");
if (promote !== null) {
  if (!promote || promote.startsWith("--")) fail("--promote needs the preview update's Group ID (the publish to preview printed it).");
  const gitAnswer = (a) => {
    const r = spawnSync("git", a, { cwd: root, encoding: "utf8" });
    return { ok: r.status === 0, out: r.stdout || "" };
  };
  if (!gitAnswer(["fetch", "--quiet", "origin", "main"]).ok) fail("git fetch origin main failed, so whether the update's commit is on main is unknown. Try again.");
  const view = spawnSync("npx", ["-y", "eas-cli@latest", "update:view", promote, "--json"], { cwd: root, encoding: "utf8" });
  const updates = parseUpdateView(`${view.stdout || ""}`);
  if (!updates) {
    console.error((view.stderr || view.stdout || "").trim().split("\n").slice(-3).join("\n"));
    fail(`could not read update group ${promote} (is it the Group ID, and is eas-cli signed in as seans-apps?).`);
  }
  const first = updates[0] ?? {};
  const commitHash = first.gitCommitHash ?? null;
  const info = commitHash ? classifyCommit(commitHash, gitAnswer) : null;
  const subject = commitHash ? gitAnswer(["log", "-1", "--format=%s", commitHash]).out.trim() : "";
  console.log(`publish-update: promote ${promote} to production`);
  console.log(`  group        ${promote}`);
  console.log(`  branch       ${[...new Set(updates.map((u) => u.branch))].join(", ")}`);
  console.log(`  commit       ${commitHash ? commitHash.slice(0, 7) : "(none recorded)"}  ${subject}${info ? `  [${info.status}]` : ""}`);
  console.log(`  message      ${first.message ?? ""}`);
  console.log(`  runtime      ${[...new Set(updates.map((u) => u.runtimeVersion))].join(", ")}   platforms ${updates.map((u) => u.platform).join(", ")}`);
  console.log(`  published    ${first.createdAt ?? "?"}`);
  const problems = promoteProblems(updates, info);
  if (problems.length) {
    for (const p of problems) console.error(`publish-update: ${p}`);
    fail("refusing to promote.");
  }
  if (info?.status === "empty-on-main")
    console.log(`  note         ${info.empty.length} Replit commit(s) on top of main, changing no files: the code is main's ${info.base.slice(0, 7)}.`);
  const promotedMsg = message ?? promotedMessage(first.message);
  const republish = ["-y", "eas-cli@latest", "update:republish", "--group", promote, "--destination-channel", "production", "--message", promotedMsg, "--non-interactive"];
  console.log(`  production   ${promotedMsg}`);
  if (dryRun) {
    console.log(`  would run    npx ${republish.join(" ")}`);
    process.exit(0);
  }
  const done = spawnSync("npx", republish, { cwd: root, stdio: "inherit" });
  if (done.status === 0)
    console.log('\npublish-update: promoted. Other phones get it within two launches. To pull it back: docs/next-publish.md, "If an update breaks the phone".');
  process.exit(done.status ?? 1);
}

if (!message) fail('say what the update is: --message "…" (it is what the EAS dashboard lists).');

const eas = JSON.parse(readFileSync(join(root, "eas.json"), "utf8"));
const profile = Object.entries(eas.build ?? {}).find(([, p]) => p.channel === channel);
if (!profile) fail(`no build profile in eas.json uses channel "${channel}", so no installed app listens on it.`);
const [profileName, profileConfig] = profile;
const domain = profileConfig.env?.EXPO_PUBLIC_DOMAIN;
if (!domain)
  fail(`build profile "${profileName}" sets no EXPO_PUBLIC_DOMAIN, so an update could not know which server its builds talk to.`);

// ---- Which code: the checkout must be origin/main's, and clean. ----
const git = (...a) => spawnSync("git", a, { cwd: root, encoding: "utf8" });
const gitOut = (...a) => {
  const r = git(...a);
  // trimEnd: porcelain status lines START with a meaningful space.
  return r.status === 0 ? r.stdout.trimEnd() : null;
};
const problems = [];
const fetched = git("fetch", "--quiet", "origin", "main");
if (fetched.status !== 0) {
  problems.push(`git fetch origin main failed, so whether this checkout is current is unknown:\n    ${(fetched.stderr || "").trim()}`);
} else {
  const behind = Number(gitOut("rev-list", "--count", "HEAD..origin/main") ?? "NaN");
  if (!(behind === 0)) {
    const latest = gitOut("log", "-1", "--format=%h %s", "origin/main");
    problems.push(
      `this checkout is ${Number.isNaN(behind) ? "an unknown number of" : behind} commit(s) behind origin/main (latest: ${latest}).\n    Pull first: cd ~/workspace && git pull`,
    );
  }
  const ahead = Number(gitOut("rev-list", "--count", "origin/main..HEAD") ?? "0");
  if (ahead > 0) console.log(`publish-update: note — ${ahead} local commit(s) not on origin/main are included.`);
}
const dirty = gitOut("status", "--porcelain", "--untracked-files=no");
if (dirty === null) problems.push("git status failed, so whether the checkout has uncommitted changes is unknown.");
else if (dirty) problems.push(`uncommitted changes to tracked files would be published:\n    ${dirty.split("\n").join("\n    ")}`);
if (problems.length) {
  for (const p of problems) console.error(`publish-update: ${p}`);
  if (!force) fail("refusing to publish. Fix the above, or pass --force to publish this checkout as it is.");
  console.error("publish-update: --force given, publishing anyway.");
}
const commit = gitOut("rev-parse", "--short=7", "HEAD") ?? "unknown";
const subject = gitOut("log", "-1", "--format=%s") ?? "";
const fullMessage = `${message} (${commit}${dirty ? "+changes" : ""})`;

const app = JSON.parse(readFileSync(join(root, "app.json"), "utf8")).expo;
console.log(`publish-update: channel ${channel} (profile "${profileName}")`);
console.log(`  commit       ${commit}${dirty ? " plus uncommitted changes" : ""}  ${subject}`);
console.log(`  channel      ${channel}`);
console.log(`  runtime      ${app.version} (reaches only builds of version ${app.version}: runtimeVersion follows the app version)`);
console.log(`  server       ${domain}`);
console.log(`  message      ${fullMessage}`);

// Newer eas-cli asks which EAS environment's hosted variables to load, and
// the answer for a channel is the environment of the same name — so it is
// passed rather than asked. (The server address never comes from there: it
// is set explicitly above, from the build profile.)
const EAS_ENVIRONMENTS = ["development", "preview", "production"];
const command = ["-y", "eas-cli@latest", "update", "--channel", channel, "--platform", "ios", "--message", fullMessage];
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
if (result.status === 0 && channel === "preview")
  console.log(
    "\npublish-update: on preview. On the phone: testing sheet › Use preview (or, already on preview, fully close and reopen twice), run the 5-minute check in docs/next-publish.md, then:\n  node scripts/publish-update.mjs --promote <the Group ID above>"
  );
if (result.status === 0 && channel === "production")
  console.log("\npublish-update: published straight to production. The flow is preview first, then --promote (docs/next-publish.md).");
process.exit(result.status ?? 1);
