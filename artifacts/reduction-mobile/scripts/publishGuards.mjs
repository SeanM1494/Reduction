/**
 * scripts/publishGuards.mjs — the checks publish-update.mjs makes before it
 * promotes a preview update to production (Oct 1). Plain JavaScript with no
 * I/O of its own: git is passed in, so lib/publishGuards.test.ts can prove
 * every refusal without a repository or the network.
 */

/**
 * Where an update's commit stands against GitHub's main.
 *
 *   on-main        the commit is on origin/main
 *   empty-on-main  it is not, but every commit between it and main changes
 *                  no file — Replit's own "Published your App" commits,
 *                  which the workspace makes and never pushes (dc85229 was
 *                  one: the Sep 30 update's code was main's exactly)
 *   not-on-main    something between main and it changes files
 *   unknown        this checkout does not have the commit at all
 *
 * `git(args)` returns { ok, out } for one git command.
 */
export function classifyCommit(commit, git) {
  if (!commit || !git(["cat-file", "-e", `${commit}^{commit}`]).ok) return { status: "unknown" };
  if (git(["merge-base", "--is-ancestor", commit, "origin/main"]).ok) return { status: "on-main" };
  const base = git(["merge-base", commit, "origin/main"]);
  if (!base.ok || !base.out.trim()) return { status: "not-on-main" };
  const between = git(["rev-list", `${base.out.trim()}..${commit}`]);
  if (!between.ok) return { status: "not-on-main" };
  const extra = between.out.split("\n").map((s) => s.trim()).filter(Boolean);
  const changing = extra.filter((c) => {
    const files = git(["diff-tree", "--no-commit-id", "--name-only", "-r", c]);
    return !files.ok || files.out.trim() !== "";
  });
  return changing.length ? { status: "not-on-main", changing } : { status: "empty-on-main", base: base.out.trim(), empty: extra };
}

/** `eas update:view <group> --json` prints an array; tolerate log lines
 *  around it (expo-iap's config plugin prints two when eas loads app.json). */
export function parseUpdateView(text) {
  // The array starts a line of its own; a log line's "[expo-iap]" does not.
  const start = text.search(/^\s*\[\s*($|\{)/m);
  const end = text.lastIndexOf("]");
  if (start === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Every reason NOT to promote this group, in the order they matter. */
export function promoteProblems(updates, commitInfo, expect = { branch: "preview" }) {
  if (!updates || updates.length === 0) return ["no update group with that id — copy the Group ID that the preview publish printed"];
  const problems = [];
  const branches = [...new Set(updates.map((u) => u.branch))];
  if (branches.length !== 1 || branches[0] !== expect.branch)
    problems.push(`the group is on branch ${branches.join(", ") || "(none)"}, not ${expect.branch} — only something tested on preview is promoted`);
  const commits = [...new Set(updates.map((u) => u.gitCommitHash).filter(Boolean))];
  if (commits.length === 0) problems.push("the group records no git commit, so what it contains cannot be checked");
  else if (commits.length > 1) problems.push(`the group records more than one commit (${commits.join(", ")})`);
  if (updates.some((u) => u.isRollBackToEmbedded)) problems.push("the group is a roll-back, not an update");
  if (commitInfo) {
    if (commitInfo.status === "unknown") problems.push("this checkout does not have that commit — run git pull (or git fetch) and try again");
    if (commitInfo.status === "not-on-main")
      problems.push(
        `that commit is not on main${commitInfo.changing?.length ? ` (changes in ${commitInfo.changing.join(", ")})` : ""} — publish to preview again from a checkout of main`
      );
  }
  return problems;
}

/** The message the production copy carries: the preview's own, marked. */
export const promotedMessage = (original) => `${(original || "").replace(/\s*\(promoted from preview\)$/, "")} (promoted from preview)`.trim();
