/**
 * lib/timerAlertPolicy.ts — the decisions behind a timer alert the PHONE
 * schedules for itself, kept pure so the runner can test them under plain
 * node. lib/timerAlerts.ts is the thin layer that asks the OS; nothing here
 * imports it, react-native, or the `@/` alias.
 *
 * WHY THE PHONE SCHEDULES ITS OWN ALERT. Until Oct 5 the only alert was a
 * push the server sent when a timer came due — and the server is Autoscale,
 * asleep whenever nobody is using it, so a timer coming due long after the
 * app was closed made no sound at all. A notification scheduled on the
 * device at `endsAt` is delivered by iOS whether the app, or the server, is
 * running. The server's push still exists for the website and for phones
 * running an older bundle; a phone running this one hands its push token
 * back (lib/timerAlerts.ts), or every alert would arrive twice.
 *
 * THE LIBRARY IS THE SCHEDULE. Every entry's `timer` is the whole truth:
 * the alerts pending on the device are reconciled against it on every
 * change, so a timer started, cancelled, finished or moved on another
 * device is followed here the next time the library loads — nothing keeps
 * a second list that could disagree.
 */

/** The shape this needs from a library entry, structurally, so the test
 *  runner can load this file without the app's types. */
export interface TimedEntry {
  id: string;
  timer: { stepId: string; endsAt: number } | null;
  recipe: {
    title?: string | null;
    sections?: { nodes?: { id: string; label?: string | null }[] | null }[] | null;
  } | null;
}

export interface PlannedAlert {
  /** One alert per recipe: a recipe has one timer at a time, and the
   *  identifier is what a later reconcile cancels or replaces. */
  identifier: string;
  endsAt: number;
  title: string;
  body: string;
  /** The same `data` the server's push carries (its TimerPayload, less the
   *  copy), so `notificationTarget` opens the recipe for either. */
  data: { kind: "timer"; recipeId: string; stepId: string; endsAt: number };
}

/** What the OS reports as pending: its identifier and the `data` we gave it. */
export interface PendingAlert {
  identifier: string;
  data: unknown;
}

export const ALERT_PREFIX = "timer:";

/** The server's own ceiling (routes/library.ts MAX_TIMER_MS): a timer
 *  further out than a day is a bad clock or a bad tree, not dinner. */
export const MAX_TIMER_MS = 24 * 60 * 60 * 1000;

const alertId = (recipeId: string) => `${ALERT_PREFIX}${recipeId}`;

/** The copy matches the server's push (timerDispatch.ts) word for word:
 *  the recipe is the title because that is what identifies it on a lock
 *  screen, and the step says what to do next. */
function copyFor(e: TimedEntry): { title: string; body: string } {
  const step = e.recipe?.sections
    ?.flatMap((s) => s?.nodes ?? [])
    .find((n) => n?.id === e.timer!.stepId);
  const title = typeof e.recipe?.title === "string" && e.recipe.title.trim() ? e.recipe.title : "Timer done";
  const body = step?.label ? `Time's up — ${step.label}` : "Your timer is done.";
  return { title, body };
}

/** Every alert the device should have pending right now. A timer already
 *  past is not scheduled — the cook screen says so itself when it opens. */
export function plannedAlerts(entries: readonly TimedEntry[], now: number): PlannedAlert[] {
  const out: PlannedAlert[] = [];
  for (const e of entries) {
    const t = e.timer;
    if (!t || typeof t.stepId !== "string" || !Number.isFinite(t.endsAt)) continue;
    const delta = t.endsAt - now;
    if (delta <= 0 || delta > MAX_TIMER_MS) continue;
    out.push({
      identifier: alertId(e.id),
      endsAt: t.endsAt,
      ...copyFor(e),
      data: { kind: "timer", recipeId: e.id, stepId: t.stepId, endsAt: t.endsAt },
    });
  }
  return out;
}

function pendingKey(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  return typeof d.stepId === "string" && typeof d.endsAt === "number" ? `${d.stepId}@${d.endsAt}` : null;
}

/**
 * What to change so the pending alerts match the plan. Only identifiers
 * with our prefix are ever cancelled — nothing else on the device is ours
 * to touch. An alert already pending for the same step and end time is
 * left alone (rescheduling it would be harmless, but it is a native call
 * per entry on every library change). The title is NOT compared: a rename
 * mid-timer keeps the old name on the lock screen, which is not worth a
 * reschedule per keystroke.
 */
export function reconcileAlerts(
  plan: readonly PlannedAlert[],
  pending: readonly PendingAlert[]
): { cancel: string[]; schedule: PlannedAlert[] } {
  const want = new Map(plan.map((p) => [p.identifier, p]));
  const have = new Map<string, string | null>();
  for (const p of pending) {
    if (p.identifier.startsWith(ALERT_PREFIX)) have.set(p.identifier, pendingKey(p.data));
  }
  const cancel = [...have.keys()].filter((id) => !want.has(id));
  const schedule = plan.filter((p) => have.get(p.identifier) !== `${p.data.stepId}@${p.endsAt}`);
  return { cancel, schedule };
}

/**
 * What the Settings card shows (the native app; the website keeps its own
 * push card), and which arm rings.
 *
 *  - unsupported: the web build, which has no scheduled notifications.
 *  - denied: the OS said no to notifications and will not ask again — the
 *    system Settings is the only way back, so the card says that rather
 *    than offering a tap.
 *  - alarm: chosen in the card AND AlarmKit authorized (iOS 26+). Timers
 *    ring as system alarms instead of notifications — never both, or
 *    every timer would sound twice.
 *  - on: notifications allowed, and not switched off in the card.
 *  - off: switched off in the card, or never asked.
 *
 * A device that granted permission before this existed reads as ON with no
 * stored choice: the only thing Reduction ever asked permission for is
 * timers, so a yes was a yes to these. A chosen alarm whose authorization
 * was later withdrawn in Settings falls back to notifications rather than
 * to silence.
 */
export type AlertState = "unsupported" | "denied" | "alarm" | "on" | "off";

export type AlarmAuth = "authorized" | "denied" | "notDetermined" | "unavailable";

export interface AlertFacts {
  platform: string;
  permission: "granted" | "denied" | "undetermined" | null;
  /** The card's own switch, as stored; null when never set. */
  choice: "on" | "off" | "alarm" | null;
  /** AlarmKit's authorization; "unavailable" before iOS 26, on a binary
   *  without the module, and everywhere but iOS. */
  alarm: AlarmAuth;
}

export function deriveAlertState(f: AlertFacts): AlertState {
  if (f.platform === "web") return "unsupported";
  if (f.choice === "alarm" && f.alarm === "authorized") return "alarm";
  if (f.permission === "denied") return "denied";
  if (f.permission !== "granted") return "off";
  return f.choice === "off" ? "off" : "on";
}

/** Whether the card offers alarms at all: AlarmKit is there and has not
 *  been refused (a refusal is only undone in Settings, like notifications). */
export const alarmsOffered = (f: Pick<AlertFacts, "alarm">): boolean =>
  f.alarm === "authorized" || f.alarm === "notDetermined";

// ------------------------------------------------------------- alarms ---

/**
 * AlarmKit names an alarm by UUID and a recipe id is not one
 * (`newEntryId`: base36 time and random). So the alarm's id is DERIVED
 * from the recipe's — the same recipe always maps to the same alarm, with
 * nothing stored to fall out of step. Four 32-bit FNV-1a hashes with
 * different seeds, shaped as an RFC 9562 version-8 UUID (the "custom"
 * version), lowercase as the native side reports ids.
 */
export function alarmIdFor(recipeId: string): string {
  const words = [0x811c9dc5, 0x01000193, 0x5bd1e995, 0x27d4eb2f].map((seed, k) => {
    let h = (seed ^ k) >>> 0;
    for (let i = 0; i < recipeId.length; i++) {
      h ^= recipeId.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  });
  const hex = words.join("").split("");
  hex[12] = "8"; // version 8
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16); // variant 10xx
  const h = hex.join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** The alarm's one line. An alarm shows a title and nothing else, so it
 *  carries the step (what to do now) when there is one, else the recipe. */
export function alarmTitle(a: PlannedAlert): string {
  const step = a.body.startsWith("Time's up — ") ? a.body.slice("Time's up — ".length) : "";
  const t = (step || a.title).trim();
  return t.length > 40 ? `${t.slice(0, 39)}…` : t;
}

export interface ScheduledAlarm {
  id: string;
  /** Epoch ms; 0 when the alarm has no fixed date. */
  fireAt: number;
}

/**
 * The alarm arm's reconcile, the same contract as `reconcileAlerts`: what
 * to cancel and what to schedule so AlarmKit holds exactly the plan. An
 * alarm whose time moved is cancelled AND rescheduled under the same id —
 * AlarmKit does not replace an id the way a notification identifier is
 * replaced — so callers run the cancels first. Every alarm the app holds
 * is ours (AlarmKit is per app), so anything outside the plan goes.
 * Times are compared to the second, the precision a Date round trip
 * through the native side is trusted with.
 */
export function reconcileAlarms(
  plan: readonly PlannedAlert[],
  scheduled: readonly ScheduledAlarm[]
): { cancel: string[]; schedule: { id: string; fireAt: number; title: string }[] } {
  const want = new Map(plan.map((p) => [alarmIdFor(p.data.recipeId), p]));
  const have = new Map(scheduled.map((s) => [s.id.toLowerCase(), s.fireAt]));
  const sameSecond = (a: number, b: number) => Math.round(a / 1000) === Math.round(b / 1000);
  const cancel: string[] = [];
  for (const [id, fireAt] of have) {
    const p = want.get(id);
    if (!p || !sameSecond(fireAt, p.endsAt)) cancel.push(id);
  }
  const schedule = [...want]
    .filter(([id, p]) => !have.has(id) || !sameSecond(have.get(id)!, p.endsAt))
    .map(([id, p]) => ({ id, fireAt: p.endsAt, title: alarmTitle(p) }));
  return { cancel, schedule };
}
