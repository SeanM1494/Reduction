/**
 * lib/updateStatus.ts — what Settings says about the code that is running
 * (Oct 1). PURE, tested; the screen hands it what expo-constants and
 * expo-updates already report, and nothing here asks the network.
 *
 * Two readers. Everyone gets one line at the bottom of Settings, "Version
 * 1.1.0 (build 12)" — the binary, which is what a support email and the
 * App Store both name. The owner's testing sheet gets the rest: which
 * over-the-air update this launch is running (or the binary's own bundle),
 * its channel, runtime version and publish time, when the app last asked
 * for an update, and any error — so "did my update land?" is answered on
 * the phone instead of guessed at. Written after an update published on
 * Oct 1 did not appear and nothing on the phone could say why.
 */

/** expo.version and the binary's build number → the line under Settings. */
export function versionLine(appVersion: string | null | undefined, build: string | null | undefined): string | null {
  if (!appVersion) return null;
  return build ? `Version ${appVersion} (build ${build})` : `Version ${appVersion}`;
}

/** The facts expo-updates reports about this launch, flattened. */
export interface UpdateSnapshot {
  /** Updates.isEnabled — false in development and in Expo Go. */
  enabled: boolean;
  updateId: string | null;
  channel: string | null;
  runtimeVersion: string | null;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  emergencyLaunchReason: string | null;
  /** When the running bundle was published (an update) or built (embedded). */
  createdAt: Date | null;
  /** useUpdates().lastCheckForUpdateTimeSinceRestart */
  lastCheck: Date | null;
  /** A newer update is downloaded and runs on the next cold start. */
  isUpdatePending: boolean;
  checkError: string | null;
  downloadError: string | null;
}

export interface StatusRow {
  label: string;
  value: string;
}

/** An update id cut to its first 8 characters — enough to match the
 *  EAS dashboard's and `update:list`'s ids by eye. */
export function shortId(id: string | null | undefined): string | null {
  return id ? id.slice(0, 8) : null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-10-01 14:03 UTC (2 h ago)" — UTC because that is what
 *  `eas update:list` prints, so the two can be read side by side. */
export function when(at: Date | null, now: Date): string {
  if (!at || Number.isNaN(at.getTime())) return 'unknown';
  const stamp = `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`;
  const mins = Math.round((now.getTime() - at.getTime()) / 60000);
  if (mins < 0) return stamp;
  if (mins < 60) return `${stamp} (${mins} min ago)`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${stamp} (${hours} h ago)`;
  return `${stamp} (${Math.floor(hours / 24)} days ago)`;
}

export function updateRows(s: UpdateSnapshot, now: Date): StatusRow[] {
  if (!s.enabled) {
    return [{ label: 'Updates', value: 'Off in this build (development or Expo Go): it runs the code it was started with.' }];
  }
  const running = s.isEmergencyLaunch
    ? `Embedded bundle — EMERGENCY LAUNCH: ${s.emergencyLaunchReason ?? 'no reason given'}`
    : s.isEmbeddedLaunch
      ? 'Embedded bundle (the code built into this binary)'
      : `Update ${shortId(s.updateId) ?? 'unknown'}`;
  const rows: StatusRow[] = [
    { label: 'Running', value: running },
    { label: 'Channel', value: s.channel ?? 'none' },
    { label: 'Runtime version', value: s.runtimeVersion ?? 'unknown' },
    { label: s.isEmbeddedLaunch ? 'Built' : 'Published', value: when(s.createdAt, now) },
    { label: 'Last check', value: s.lastCheck ? when(s.lastCheck, now) : 'not since this launch' },
  ];
  if (s.isUpdatePending) rows.push({ label: 'Waiting', value: 'A newer update is downloaded. It runs after the app is fully closed and reopened.' });
  const errors = [s.checkError && `check: ${s.checkError}`, s.downloadError && `download: ${s.downloadError}`].filter(Boolean);
  rows.push({ label: 'Update error', value: errors.length ? errors.join('\n') : 'none' });
  return rows;
}
