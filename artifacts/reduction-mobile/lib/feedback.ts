/**
 * lib/feedback.ts — the email Settings › Send feedback opens. PURE, tested.
 *
 * The address is the contact on the legal pages (public/privacy.html and
 * terms.html, decided Sep 21); change it there and here together. The body
 * leaves room at the top for the message and lists what makes a report
 * actionable — which build, which over-the-air update, which iOS, which
 * phone — and NOTHING that identifies the person: no account id, no email
 * address, no device name (iOS's "Sean's iPhone" is a name, which is why
 * the model is `Device.modelName`, never `deviceName`). Whoever writes can
 * add their account id themselves; Settings shows it with a Copy button.
 */

export const FEEDBACK_EMAIL = 'sean@recruitthebench.com';
export const FEEDBACK_SUBJECT = 'Reduction feedback';

export interface FeedbackInfo {
  /** expo.version, e.g. 1.1.0 */
  appVersion: string | null;
  /** The binary's build number, e.g. 7. */
  build: string | null;
  runtimeVersion: string | null;
  /** The running over-the-air update; null when the binary's own bundle runs. */
  updateId: string | null;
  /** 'ios' | 'android' | ... */
  os: string;
  osVersion: string | null;
  /** e.g. "iPhone 15" — the model, never the device's name. */
  model: string | null;
}

const OS_NAME: Record<string, string> = { ios: 'iOS', android: 'Android', web: 'Web' };

export function feedbackBody(info: FeedbackInfo): string {
  const version = info.appVersion ? `${info.appVersion}${info.build ? ` (build ${info.build})` : ''}` : 'unknown';
  return [
    '',
    '',
    '',
    '— Please keep the lines below; they help find the problem —',
    `App version: ${version}`,
    `Runtime version: ${info.runtimeVersion ?? 'unknown'}`,
    `Update: ${info.updateId ?? 'none (built-in)'}`,
    `${OS_NAME[info.os] ?? info.os}: ${info.osVersion ?? 'unknown'}`,
    `Device: ${info.model ?? 'unknown'}`,
  ].join('\n');
}

export function feedbackMailto(info: FeedbackInfo): string {
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(FEEDBACK_SUBJECT)}&body=${encodeURIComponent(feedbackBody(info))}`;
}
