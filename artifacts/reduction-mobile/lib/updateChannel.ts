/**
 * lib/updateChannel.ts — the owner's switch between the production and
 * preview update channels (Oct 1). PURE, tested; the testing sheet hands it
 * expo-updates' own functions (components/settings/ChannelSwitch.tsx).
 *
 * The flow it serves: every over-the-air update goes to `preview` first,
 * the owner's phone runs it from there, and only then is the SAME bundle
 * promoted to production (scripts/publish-update.mjs --promote). Everyone
 * else's phone never leaves production; the binary says `production`, and
 * only this switch changes what one phone asks for.
 *
 * WHAT expo-updates 57.0.23 DOES (read in its iOS source, not assumed):
 * - `setUpdateRequestHeadersOverride({'expo-channel-name': …})` is saved in
 *   UserDefaults and survives restarts; `null` deletes it, and the phone is
 *   back on the channel built into the binary. It is accepted only for a
 *   header the build already carries — EAS writes the channel there — and
 *   needs no app.json flag (unlike the URL override).
 * - A CHECK stores nothing. Only a FETCH (or a launch's own fetch) records
 *   the channel's branch, which then decides which downloaded update a
 *   launch may run. So the switch can ask preview first and walk away.
 *
 * THE ONE WAY TO GET STUCK, and why this cannot reach it: a phone moved to
 * preview while preview has nothing would launch the binary's own code
 * (build 7: Sep 29, no switch in it) and have no way back but a reinstall.
 * So the override is cleared on EVERY path that does not end in a
 * downloaded preview update, and the app restarts only after the download.
 */

export const PRODUCTION = 'production';
export const PREVIEW = 'preview';

/** What the switch needs from expo-updates, injected so it can be tested. */
export interface ChannelApi {
  /** `setUpdateRequestHeadersOverride`: a channel, or null for the build's own. */
  setChannel(channel: string | null): void;
  check(): Promise<{ isAvailable: boolean; isRollBackToEmbedded?: boolean }>;
  fetch(): Promise<{ isNew: boolean; isRollBackToEmbedded?: boolean }>;
  reload(): Promise<void>;
}

export type SwitchOutcome =
  /** The app is restarting onto the other channel. */
  | { kind: 'restarting'; to: string }
  /** Preview has no update for this runtime (or only a roll-back): nothing changed. */
  | { kind: 'nothing-on-preview' }
  /** Something failed. `onChannel` is where the phone is now. */
  | { kind: 'failed'; step: 'switch' | 'check' | 'download' | 'restart'; message: string; onChannel: string };

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Clear the override, swallowing a failure to do so: there is nothing more
 *  a caller can do, and the report already names the step that failed. */
function restore(api: ChannelApi): void {
  try {
    api.setChannel(null);
  } catch {
    // Saved state is unchanged from before the switch began, or cleared.
  }
}

export async function switchToPreview(api: ChannelApi): Promise<SwitchOutcome> {
  try {
    api.setChannel(PREVIEW);
  } catch (e) {
    // Refused before anything was saved (the native side validates first).
    return { kind: 'failed', step: 'switch', message: messageOf(e), onChannel: PRODUCTION };
  }
  try {
    const found = await api.check();
    if (!found.isAvailable || found.isRollBackToEmbedded) {
      restore(api);
      return { kind: 'nothing-on-preview' };
    }
  } catch (e) {
    restore(api);
    return { kind: 'failed', step: 'check', message: messageOf(e), onChannel: PRODUCTION };
  }
  try {
    const got = await api.fetch();
    // isNew is false when the update is ALREADY on the phone (switched
    // before): still a preview update to run, so only a roll-back stops it.
    if (got.isRollBackToEmbedded) {
      restore(api);
      return { kind: 'nothing-on-preview' };
    }
  } catch (e) {
    restore(api);
    return { kind: 'failed', step: 'download', message: messageOf(e), onChannel: PRODUCTION };
  }
  try {
    await api.reload();
    return { kind: 'restarting', to: PREVIEW };
  } catch (e) {
    // The preview update is downloaded and the override saved: the next
    // full close and reopen runs it. Not stuck — it carries this switch.
    return { kind: 'failed', step: 'restart', message: messageOf(e), onChannel: PREVIEW };
  }
}

export async function switchToProduction(api: ChannelApi): Promise<SwitchOutcome> {
  try {
    api.setChannel(null);
  } catch (e) {
    return { kind: 'failed', step: 'switch', message: messageOf(e), onChannel: PREVIEW };
  }
  // Production's update, if the phone does not have it. A failure here (no
  // network) is not fatal: the override is gone, so the next launch asks
  // production on its own.
  try {
    await api.fetch();
  } catch {
    // fall through to the restart
  }
  try {
    await api.reload();
    return { kind: 'restarting', to: PRODUCTION };
  } catch (e) {
    return { kind: 'failed', step: 'restart', message: messageOf(e), onChannel: PRODUCTION };
  }
}

/** The channel this launch runs on: what expo-updates reports, else the build's. */
export const runningChannel = (reported: string | null | undefined): string => (reported && reported.trim() ? reported.trim() : PRODUCTION);

export const onPreview = (reported: string | null | undefined): boolean => runningChannel(reported) !== PRODUCTION;

/** " · preview" after the version line, only off production. */
export const channelSuffix = (reported: string | null | undefined): string => (onPreview(reported) ? ` · ${runningChannel(reported)}` : '');

/** The sentence the sheet shows for an outcome. */
export function outcomeMessage(o: SwitchOutcome): string {
  switch (o.kind) {
    case 'restarting':
      return `Restarting on ${o.to}…`;
    case 'nothing-on-preview':
      return 'Preview has no update for this version yet. Staying on production.';
    case 'failed': {
      const where = o.onChannel === PREVIEW ? 'preview' : 'production';
      const what = { switch: 'Could not switch', check: 'Could not check preview', download: 'Could not download the preview update', restart: 'Could not restart' }[o.step];
      const next = o.step === 'restart' ? ' Fully close the app and open it again.' : '';
      return `${what} (${o.message}). On ${where}.${next}`;
    }
  }
}
