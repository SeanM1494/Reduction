/**
 * crashReport.ts — the shape of a crash report and the scrubbing that keeps
 * it anonymous (Oct 1). Not recipe model; it lives in this package because
 * it is the one dependency-free module all three of the phone, the website
 * and the server import, and the scrub has to be the SAME function on the
 * device (so nothing leaves it) and on the server (so nothing a forged
 * report sends is stored). Two copies would drift, and the drift would be a
 * privacy bug.
 *
 * WHAT A REPORT MAY CARRY: what failed (the error's name, its scrubbed
 * message), where in the code (stack frames, file BASENAME + line:column),
 * which screen (the route PATTERN, never a recipe id) and which build. No
 * account, no device identifier, no recipe content. privacy.html promises
 * exactly that; a new field here is a change to that page.
 *
 * Paths are cut to their basename because an iOS bundle path carries the
 * app container's UUID (`/var/containers/Bundle/Application/<UUID>/...`),
 * which is stable per install — a device identifier by another name.
 */

export const CRASH_KINDS = ["render", "fatal", "error", "emergency_launch"] as const;
export type CrashKind = (typeof CRASH_KINDS)[number];

export const CRASH_PLATFORMS = ["ios", "android", "web"] as const;
export type CrashPlatform = (typeof CRASH_PLATFORMS)[number];

export const CRASH_LIMITS = { message: 300, frames: 15, frame: 160, name: 60, route: 80, field: 64 } as const;

export interface CrashReport {
  kind: CrashKind;
  platform: CrashPlatform;
  /** The error's class: TypeError, ApiError, … */
  name: string;
  message: string;
  stack: string[];
  /** A route pattern (`/recipe/[id]`), not a path. */
  route: string | null;
  appVersion: string | null;
  runtime: string | null;
  updateId: string | null;
  channel: string | null;
  osVersion: string | null;
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s'"`)<>]*/gi;
const EMAIL = /[^\s@'"`(<]+@[^\s@'"`)>]+\.[a-z]{2,}/gi;
const LONG_HEX = /\b[0-9a-f]{16,}\b/gi;
const LONG_DIGITS = /\d{5,}/g;
// Anything quoted is presumed content (a recipe title, a server's sentence,
// a JSON token) EXCEPT the code Hermes and JavaScriptCore quote after
// "evaluating", which is the most useful part of the commonest error there
// is: `undefined is not an object (evaluating 'recipe.sections[0]')`.
// Each pattern's last two groups are (what precedes the opening quote, the
// quoted run). No lookbehind: not every JS engine the app has shipped on
// is certain to have it, and a regex that fails to compile here would fail
// inside the crash handler.
const QUOTED: readonly RegExp[] = [
  /()("[^"]*")/g,
  /()(\u201c[^\u201d]*\u201d)/g,
  /()(`[^`]*`)/g,
  // Single quotes only where they open and close, so an apostrophe
  // ("Mom's") is not taken for one.
  /(^|[^\w])('[^']*')(?!\w)/g,
  /()(\u2018[^\u2019]*\u2019)/g,
];
const unquote = (s: string): string =>
  QUOTED.reduce(
    (acc, re) =>
      acc.replace(re, (all: string, pre: string, quoted: string, offset: number, whole: string) =>
        /evaluating\s*$/.test(whole.slice(0, offset + pre.length)) ? all : `${pre}${quoted[0]}…${quoted[quoted.length - 1]}`
      ),
    s
  );

const clamp = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** A message with anything that could be somebody's content taken out. */
export function scrubText(raw: unknown, max: number = CRASH_LIMITS.message): string {
  const s = typeof raw === "string" ? raw : raw == null ? "" : String(raw);
  return clamp(
    unquote(s)
      .replace(URL_RE, "<url>")
      .replace(EMAIL, "<email>")
      .replace(UUID, "<id>")
      .replace(LONG_HEX, "<id>")
      .replace(LONG_DIGITS, "<n>")
      .replace(/\s+/g, " ")
      .trim(),
    max
  );
}

/** A frame's location (`/long/path/main.jsbundle:1:2`, a URL, `native`) as
 *  its file's basename plus line:column. Paths can contain spaces
 *  ("Application Support"), so this takes everything after the last slash. */
function basenameOf(loc: string): string {
  const tail = loc.replace(/^address at\s+/, "").split("/").pop() ?? "";
  return tail.replace(/\?[^:]*/, "");
}

// A frame is code, but the server also scrubs frames a forged report sends,
// so anything in one that reads as a person's data goes. Applied to each
// PART: Safari's whole "render@index.js:2:40" would read as an email.
const scrubPart = (p: string): string => p.replace(EMAIL, "<email>").replace(UUID, "<id>");

/** One stack frame, with every path cut to its basename. */
export function scrubFrame(raw: string): string {
  let s = raw.trim().replace(/^at\s+/, "");
  const paren = /^(.*?)\s*\((.*)\)$/.exec(s);
  const at = /^([^@\s]*)@(\S*)$/.exec(s);
  if (paren) s = `${scrubPart(paren[1]!)} (${scrubPart(basenameOf(paren[2]!))})`;
  else if (at) s = `${scrubPart(at[1]!)}@${scrubPart(basenameOf(at[2]!))}`;
  else s = scrubPart(basenameOf(s));
  return clamp(s.replace(/\s+/g, " ").trim(), CRASH_LIMITS.frame);
}

/** The frames of an `error.stack`, scrubbed, without the leading message line. */
export function framesOf(stack: unknown, max: number = CRASH_LIMITS.frames): string[] {
  if (typeof stack !== "string") return [];
  const lines = stack.split("\n").map((l) => l.trim());
  // V8 and Hermes write "at …"; Safari writes "fn@location" with no
  // spaces. Nothing looser: the first line is the MESSAGE, and a message
  // holding an email address once passed for a Safari frame.
  const frames = lines.filter((l) => /^at\s/.test(l) || /^[^\s@]*@\S+$/.test(l) || l === "[native code]");
  return frames.slice(0, max).map(scrubFrame).filter(Boolean);
}

/** A React component stack (`in Foo (at ...)` / `at Foo`) as component names. */
export function componentFrames(componentStack: unknown, max = 5): string[] {
  if (typeof componentStack !== "string") return [];
  return componentStack
    .split("\n")
    .map((l) => l.trim().replace(/^(in|at)\s+/, "").split(/\s/)[0] ?? "")
    .filter((n) => /^[A-Za-z_$][\w$.]*$/.test(n))
    .slice(0, max)
    .map((n) => `<${clamp(n, 60)}>`);
}

const FIELD = /^[\w.\-+ ()/:]{1,64}$/;
const field = (v: unknown): string | null => (typeof v === "string" && FIELD.test(v) ? v : null);

/** A route pattern; anything that looks like data in it is replaced. */
export function scrubRoute(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const s = scrubText(v, CRASH_LIMITS.route).replace(/[^\w\-/[\]().<>]/g, "");
  return s || null;
}

export interface CrashContext {
  platform: CrashPlatform;
  route?: string | null;
  appVersion?: string | null;
  runtime?: string | null;
  updateId?: string | null;
  channel?: string | null;
  osVersion?: string | null;
}

/** Builds a report from whatever was thrown. Never throws itself. */
export function crashReportFrom(
  kind: CrashKind,
  thrown: unknown,
  ctx: CrashContext,
  componentStack?: unknown
): CrashReport {
  const e = (thrown ?? {}) as { name?: unknown; message?: unknown; stack?: unknown };
  const isObj = typeof thrown === "object" && thrown !== null;
  const name = isObj && typeof e.name === "string" ? e.name : typeof thrown;
  const message = isObj ? e.message : thrown;
  const comps = componentFrames(componentStack);
  const frames = framesOf(isObj ? e.stack : undefined, CRASH_LIMITS.frames - comps.length);
  return sanitizeCrashReport({ kind, name, message, stack: [...frames, ...comps], ...ctx })!;
}

/**
 * The server's gate, and the last step of `crashReportFrom`: a report with
 * every field re-scrubbed and clamped, or null when it is not a report.
 */
export function sanitizeCrashReport(body: unknown): CrashReport | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!(CRASH_KINDS as readonly unknown[]).includes(b.kind)) return null;
  if (!(CRASH_PLATFORMS as readonly unknown[]).includes(b.platform)) return null;
  const stack = Array.isArray(b.stack)
    ? b.stack.filter((f): f is string => typeof f === "string").slice(0, CRASH_LIMITS.frames).map(scrubFrame).filter(Boolean)
    : [];
  const name = scrubText(b.name, CRASH_LIMITS.name).replace(/[^\w.$ -]/g, "") || "Error";
  return {
    kind: b.kind as CrashKind,
    platform: b.platform as CrashPlatform,
    name,
    message: scrubText(b.message),
    stack,
    route: scrubRoute(b.route),
    appVersion: field(b.appVersion),
    runtime: field(b.runtime),
    updateId: typeof b.updateId === "string" && /^[0-9a-f-]{36}$/i.test(b.updateId) ? b.updateId.toLowerCase() : null,
    channel: field(b.channel),
    osVersion: field(b.osVersion),
  };
}

/**
 * What groups two reports as the same crash: the kind, the error's class and
 * the top frames — line:column included, so one bug in two builds is two
 * groups, each of which names its update. The message is used only when
 * there are no frames, with its numbers taken out.
 */
export function crashFingerprintSource(r: CrashReport): string {
  const where = r.stack.length ? r.stack.slice(0, 5).join("|") : r.message.replace(/\d+/g, "#");
  return `${r.kind}|${r.platform}|${r.name}|${where}`;
}
