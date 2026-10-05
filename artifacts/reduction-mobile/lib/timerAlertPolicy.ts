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
 * push card).
 *
 *  - unsupported: the web build, which has no scheduled notifications.
 *  - denied: the OS said no and will not ask again — the system Settings
 *    is the only way back, so the card says that rather than offering a tap.
 *  - on: allowed, and not switched off in the card.
 *  - off: switched off in the card, or never asked.
 *
 * A device that granted permission before this existed reads as ON with no
 * stored choice: the only thing Reduction ever asked permission for is
 * timers, so a yes was a yes to these.
 */
export type AlertState = "unsupported" | "denied" | "on" | "off";

export interface AlertFacts {
  platform: string;
  permission: "granted" | "denied" | "undetermined" | null;
  /** The card's own switch, as stored; null when never set. */
  choice: "on" | "off" | null;
}

export function deriveAlertState(f: AlertFacts): AlertState {
  if (f.platform === "web") return "unsupported";
  if (f.permission === "denied") return "denied";
  if (f.permission !== "granted") return "off";
  return f.choice === "off" ? "off" : "on";
}
