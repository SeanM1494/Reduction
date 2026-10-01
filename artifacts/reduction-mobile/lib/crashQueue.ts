/**
 * lib/crashQueue.ts — which crash reports the phone sends, and the reports
 * a fatal error leaves for the next launch (Oct 1). PURE, tested; the
 * react-native half is lib/crashReporter.ts.
 *
 * A render loop or a failing timer can throw the same error hundreds of
 * times a minute, so a process sends each distinct crash ONCE and at most
 * PER_PROCESS reports in all. The server brakes too; this is so a phone
 * never spends its battery and data on a flood in the first place.
 *
 * A fatal error closes the app before a request can finish, so the report
 * is written to storage and sent at the next launch. At most QUEUE_MAX wait;
 * the newest win, because the newest build's crash is the one to fix.
 */

import { crashFingerprintSource, sanitizeCrashReport, type CrashReport } from '@workspace/recipe-model/crashReport';

export const PER_PROCESS = 10;
export const QUEUE_MAX = 5;
export const PENDING_KEY = 'crash:pending:v1';

export interface SendState {
  sent: Set<string>;
  count: number;
}

export const freshSendState = (): SendState => ({ sent: new Set(), count: 0 });

/** Whether to send this report now; records it when the answer is yes. */
export function claimSend(state: SendState, report: CrashReport): boolean {
  const key = crashFingerprintSource(report);
  if (state.count >= PER_PROCESS || state.sent.has(key)) return false;
  state.sent.add(key);
  state.count += 1;
  return true;
}

/** The stored queue, whatever was stored: anything that is not a report is dropped. */
export function parseQueue(raw: string | null): CrashReport[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list.map(sanitizeCrashReport).filter((r): r is CrashReport => r !== null).slice(-QUEUE_MAX) : [];
  } catch {
    return [];
  }
}

export function enqueue(queue: readonly CrashReport[], report: CrashReport): CrashReport[] {
  return [...queue, report].slice(-QUEUE_MAX);
}
