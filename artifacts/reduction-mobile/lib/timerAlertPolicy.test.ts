import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alarmIdFor,
  alarmsOffered,
  alarmTitle,
  deriveAlertState,
  MAX_TIMER_MS,
  plannedAlerts,
  reconcileAlarms,
  reconcileAlerts,
  type AlertFacts,
  type TimedEntry,
} from "./timerAlertPolicy";
import { notificationTarget } from "./pushPolicy";

const NOW = 1_800_000_000_000;
const recipe = {
  title: "Mongolian Beef",
  sections: [{ nodes: [{ id: "s1", label: "Simmer the sauce" }, { id: "s2", label: null }] }],
};
const entry = (id: string, timer: TimedEntry["timer"], r: TimedEntry["recipe"] = recipe): TimedEntry => ({ id, timer, recipe: r });

test("plannedAlerts: one alert per running timer, with the server push's copy", () => {
  const plan = plannedAlerts([entry("r1", { stepId: "s1", endsAt: NOW + 60_000 }), entry("r2", null)], NOW);
  assert.deepEqual(plan, [
    {
      identifier: "timer:r1",
      endsAt: NOW + 60_000,
      title: "Mongolian Beef",
      body: "Time's up — Simmer the sauce",
      data: { kind: "timer", recipeId: "r1", stepId: "s1", endsAt: NOW + 60_000 },
    },
  ]);
});

test("plannedAlerts: a tapped alert opens its recipe, exactly as a pushed one does", () => {
  const [a] = plannedAlerts([entry("r1", { stepId: "s1", endsAt: NOW + 1 })], NOW);
  assert.deepEqual(notificationTarget(a.data), { recipeId: "r1", stepId: "s1" });
});

test("plannedAlerts: a past, a too-distant or a broken timer schedules nothing", () => {
  const plan = plannedAlerts(
    [
      entry("past", { stepId: "s1", endsAt: NOW }),
      entry("far", { stepId: "s1", endsAt: NOW + MAX_TIMER_MS + 1 }),
      entry("nan", { stepId: "s1", endsAt: Number.NaN }),
      entry("edge", { stepId: "s1", endsAt: NOW + MAX_TIMER_MS }),
    ],
    NOW
  );
  assert.deepEqual(plan.map((p) => p.identifier), ["timer:edge"]);
});

test("plannedAlerts: falls back to the server's wording when the step or title is missing", () => {
  const [unlabelled] = plannedAlerts([entry("r1", { stepId: "s2", endsAt: NOW + 5 })], NOW);
  assert.equal(unlabelled.body, "Your timer is done.");
  const [gone] = plannedAlerts([entry("r1", { stepId: "zz", endsAt: NOW + 5 }, { title: "  ", sections: null })], NOW);
  assert.equal(gone.title, "Timer done");
  assert.equal(gone.body, "Your timer is done.");
  const [noTree] = plannedAlerts([entry("r1", { stepId: "s1", endsAt: NOW + 5 }, null)], NOW);
  assert.equal(noTree.title, "Timer done");
});

test("reconcileAlerts: schedules what is new, leaves what matches, cancels what went", () => {
  const plan = plannedAlerts(
    [entry("keep", { stepId: "s1", endsAt: NOW + 10 }), entry("new", { stepId: "s1", endsAt: NOW + 20 })],
    NOW
  );
  const pending = [
    { identifier: "timer:keep", data: { kind: "timer", recipeId: "keep", stepId: "s1", endsAt: NOW + 10 } },
    { identifier: "timer:gone", data: { kind: "timer", recipeId: "gone", stepId: "s1", endsAt: NOW + 30 } },
  ];
  const { cancel, schedule } = reconcileAlerts(plan, pending);
  assert.deepEqual(cancel, ["timer:gone"]);
  assert.deepEqual(schedule.map((s) => s.identifier), ["timer:new"]);
});

test("reconcileAlerts: a restarted or moved timer is rescheduled under the same identifier", () => {
  const pending = [{ identifier: "timer:r1", data: { stepId: "s1", endsAt: NOW + 10 } }];
  const later = plannedAlerts([entry("r1", { stepId: "s1", endsAt: NOW + 99 })], NOW);
  assert.deepEqual(reconcileAlerts(later, pending), { cancel: [], schedule: later });
  const nextStep = plannedAlerts([entry("r1", { stepId: "s2", endsAt: NOW + 10 })], NOW);
  assert.deepEqual(reconcileAlerts(nextStep, pending), { cancel: [], schedule: nextStep });
  // Unreadable data is treated as stale, never as a match.
  const garbled = [{ identifier: "timer:r1", data: null }];
  const same = plannedAlerts([entry("r1", { stepId: "s1", endsAt: NOW + 10 })], NOW);
  assert.deepEqual(reconcileAlerts(same, garbled).schedule, same);
});

test("reconcileAlerts: never cancels a notification that is not a timer alert", () => {
  const pending = [
    { identifier: "something-else", data: {} },
    { identifier: "timer:r1", data: { stepId: "s1", endsAt: NOW + 10 } },
  ];
  assert.deepEqual(reconcileAlerts([], pending), { cancel: ["timer:r1"], schedule: [] });
});

const facts: AlertFacts = { platform: "ios", permission: "granted", choice: null, alarm: "unavailable" };

test("deriveAlertState: the web has none; denied beats any choice", () => {
  assert.equal(deriveAlertState({ ...facts, platform: "web" }), "unsupported");
  assert.equal(deriveAlertState({ ...facts, permission: "denied", choice: "on" }), "denied");
});

test("deriveAlertState: a permission granted before this existed reads as on", () => {
  assert.equal(deriveAlertState(facts), "on");
  assert.equal(deriveAlertState({ ...facts, choice: "on" }), "on");
  assert.equal(deriveAlertState({ ...facts, choice: "off" }), "off");
});

test("deriveAlertState: never asked, or unknown, is off — a toggle, not an alert that fails", () => {
  assert.equal(deriveAlertState({ ...facts, permission: "undetermined", choice: "on" }), "off");
  assert.equal(deriveAlertState({ ...facts, permission: null }), "off");
});

test("deriveAlertState: alarms ring only when chosen AND authorized, and beat a notification refusal", () => {
  assert.equal(deriveAlertState({ ...facts, choice: "alarm", alarm: "authorized" }), "alarm");
  assert.equal(deriveAlertState({ ...facts, permission: "denied", choice: "alarm", alarm: "authorized" }), "alarm");
  // Not chosen: authorization alone switches nothing.
  assert.equal(deriveAlertState({ ...facts, alarm: "authorized" }), "on");
});

test("deriveAlertState: an alarm choice whose authorization went falls back to notifications, not silence", () => {
  assert.equal(deriveAlertState({ ...facts, choice: "alarm", alarm: "denied" }), "on");
  assert.equal(deriveAlertState({ ...facts, choice: "alarm", alarm: "unavailable" }), "on");
  assert.equal(deriveAlertState({ ...facts, permission: "denied", choice: "alarm", alarm: "denied" }), "denied");
  assert.equal(deriveAlertState({ ...facts, platform: "web", choice: "alarm", alarm: "authorized" }), "unsupported");
});

test("alarmsOffered: only where AlarmKit is there and has not been refused", () => {
  assert.equal(alarmsOffered({ alarm: "authorized" }), true);
  assert.equal(alarmsOffered({ alarm: "notDetermined" }), true);
  assert.equal(alarmsOffered({ alarm: "denied" }), false);
  assert.equal(alarmsOffered({ alarm: "unavailable" }), false);
});

const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("alarmIdFor: a stable, well-formed UUID per recipe, distinct across recipes", () => {
  const a = alarmIdFor("lzq3k1-abc12345");
  assert.match(a, UUID_V8);
  assert.equal(alarmIdFor("lzq3k1-abc12345"), a);
  const ids = new Set<string>();
  for (let i = 0; i < 20_000; i++) {
    const id = alarmIdFor(`${(1_700_000_000_000 + i * 7919).toString(36)}-${(i * 2654435761 >>> 0).toString(36)}`);
    assert.match(id, UUID_V8);
    ids.add(id);
  }
  assert.equal(ids.size, 20_000);
  assert.match(alarmIdFor(""), UUID_V8);
});

test("alarmTitle: the step when there is one, else the recipe, kept short", () => {
  const [withStep] = plannedAlerts([entry("r1", { stepId: "s1", endsAt: NOW + 5 })], NOW);
  assert.equal(alarmTitle(withStep), "Simmer the sauce");
  const [noStep] = plannedAlerts([entry("r1", { stepId: "s2", endsAt: NOW + 5 })], NOW);
  assert.equal(alarmTitle(noStep), "Mongolian Beef");
  const long = { ...withStep, body: `Time's up — ${"x".repeat(60)}` };
  assert.equal(alarmTitle(long).length, 40);
  assert.ok(alarmTitle(long).endsWith("…"));
});

test("reconcileAlarms: schedules new, keeps matching, cancels gone, and replaces a moved alarm", () => {
  const plan = plannedAlerts(
    [
      entry("keep", { stepId: "s1", endsAt: NOW + 60_000 }),
      entry("new", { stepId: "s1", endsAt: NOW + 120_000 }),
      entry("moved", { stepId: "s1", endsAt: NOW + 300_000 }),
    ],
    NOW
  );
  const scheduled = [
    // Upper case, as a UUID can come back from the native side; and a
    // Date round trip that lost the milliseconds.
    { id: alarmIdFor("keep").toUpperCase(), fireAt: NOW + 60_000 - 400 },
    { id: alarmIdFor("moved"), fireAt: NOW + 200_000 },
    { id: alarmIdFor("gone"), fireAt: NOW + 10_000 },
  ];
  const { cancel, schedule } = reconcileAlarms(plan, scheduled);
  assert.deepEqual(cancel.sort(), [alarmIdFor("gone"), alarmIdFor("moved")].sort());
  assert.deepEqual(
    schedule.map((s) => [s.id, s.fireAt]).sort(),
    [
      [alarmIdFor("new"), NOW + 120_000],
      [alarmIdFor("moved"), NOW + 300_000],
    ].sort()
  );
  assert.equal(schedule[0].title, "Simmer the sauce");
});

test("reconcileAlarms: an empty plan cancels everything held, including an undated alarm", () => {
  const scheduled = [{ id: alarmIdFor("a"), fireAt: 0 }, { id: alarmIdFor("b"), fireAt: NOW }];
  assert.deepEqual(reconcileAlarms([], scheduled), { cancel: [alarmIdFor("a"), alarmIdFor("b")], schedule: [] });
  assert.deepEqual(reconcileAlarms([], []), { cancel: [], schedule: [] });
});
