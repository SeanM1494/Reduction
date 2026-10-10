/**
 * lib/settingsSummary.ts — the short value on the right of each Settings
 * row, and the plan sentence on the account card. Pure, so the runner can
 * test it; the screen only places them.
 */

import type { AlertState } from './timerAlertPolicy';

export function timerSummary(state: AlertState | null): string {
  switch (state) {
    case 'on':
      return 'Notifications';
    case 'alarm':
      return 'Alarm';
    case 'denied':
      return 'Blocked';
    case 'unsupported':
      return 'Not available';
    case 'off':
      return 'Off';
    default:
      return '';
  }
}

export function boxSummary(style: 'books' | 'grid', liveBooks: number): string {
  return style === 'grid' ? 'Grid' : liveBooks === 1 ? 'Books · 1' : `Books · ${liveBooks}`;
}

export interface PlanFacts {
  subscribed?: boolean;
  reason?: string;
  allowance: number;
  used: number;
}

/** The plan in a few words: the account card's second line. */
export function planSummary(e: PlanFacts | null | undefined): string {
  if (!e) return '—';
  if (e.subscribed) return 'Unlimited recipes';
  if (e.reason === 'within_allowance') {
    const left = Math.max(0, e.allowance - e.used);
    return left === 1 ? '1 free recipe left' : `${left} free recipes left`;
  }
  if (e.reason === 'exhausted') return 'Free recipes used';
  return '—';
}
