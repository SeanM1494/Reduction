/**
 * lib/opening/cadence.ts — whether this launch plays the opening sequence,
 * and which one. PURE; the rules are the owner's (Sep 29) and ROADMAP
 * carries them as decided.
 *
 *   - Full: once, on the first launch after install. Never again, updates
 *     included.
 *   - Quick: on a COLD start (a new JS process) only, at most once per 24
 *     hours of elapsed time since either version last started. A stored
 *     time in the future — the clock was moved back — counts as elapsed.
 *   - Never both in one launch; the Full one stamps the time too.
 *   - None when the launch came from a notification tap, a link or a share,
 *     when VoiceOver is running, or when the switch is off.
 *   - Reduce Motion plays the still version instead of either, and it
 *     counts as that version having been shown.
 *
 * Deciding waits until the app is ACTIVE: iOS can start the process in the
 * background, and a sequence nobody sees must neither play nor stamp.
 */

import { QUICK_INTERVAL_MS } from './config';

export type LaunchSource = 'normal' | 'notification' | 'link' | 'share';

export interface LaunchFacts {
  enabled: boolean;
  now: number;
  /** The Full version has started on this device before. */
  fullShown: boolean;
  /** When either version last started (ms since epoch), or null. */
  lastShownAt: number | null;
  /** This is the first time this JS process has become active. */
  coldStart: boolean;
  /** The app is in the foreground (never decide in the background). */
  active: boolean;
  source: LaunchSource;
  screenReader: boolean;
  reduceMotion: boolean;
}

export type Version = 'full' | 'quick';

export interface Decision {
  /** What to draw: the animation, the still, or nothing. */
  play: 'animated' | 'static' | 'none';
  /** Which version it counts as (for the stamps). */
  version: Version | null;
  reason: string;
}

const none = (reason: string): Decision => ({ play: 'none', version: null, reason });

export function quickDue(now: number, lastShownAt: number | null) {
  if (lastShownAt === null || !Number.isFinite(lastShownAt)) return true;
  if (lastShownAt > now) return true; // the clock went backwards
  return now - lastShownAt >= QUICK_INTERVAL_MS;
}

export function chooseOpening(f: LaunchFacts): Decision {
  if (!f.enabled) return none('switched off');
  if (!f.active) return none('not active yet');
  if (!f.coldStart) return none('not a cold start');
  if (f.source !== 'normal') return none(`launched from a ${f.source}`);
  if (f.screenReader) return none('VoiceOver is running');
  let version: Version | null = null;
  if (!f.fullShown) version = 'full';
  else if (quickDue(f.now, f.lastShownAt)) version = 'quick';
  if (!version) return none('shown within the last 24 hours');
  return { play: f.reduceMotion ? 'static' : 'animated', version, reason: version === 'full' ? 'first launch' : '24 hours since the last' };
}

export interface Stamps { fullShown: boolean; lastShownAt: number | null }

/** What to store once the sequence is actually on screen and started. A
 *  replay from Settings stores nothing. */
export function stampFor(version: Version, now: number, prev: Stamps): Stamps {
  return { fullShown: prev.fullShown || version === 'full', lastShownAt: now };
}
