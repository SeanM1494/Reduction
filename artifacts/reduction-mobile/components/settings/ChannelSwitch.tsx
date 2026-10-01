/**
 * components/settings/ChannelSwitch.tsx — "Updates from: production /
 * preview", in the owner's testing sheet only (Oct 1). The logic, and the
 * reasons it can never leave the phone on a channel with no way back, are
 * lib/updateChannel.ts; this only wires expo-updates' own functions to it
 * and says what happened.
 *
 * On preview the one button is "Back to production". It is in Settings,
 * which a preview update that breaks some other screen still opens; a
 * preview update that cannot start at all is the case docs/next-publish.md
 * covers (republish a good update to preview, or reinstall from TestFlight,
 * which deletes the saved override).
 */

import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SheetButton } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { loadUpdates, updatesUsable } from '@/components/settings/loadUpdates';
import { PREVIEW, onPreview, outcomeMessage, runningChannel, switchToPreview, switchToProduction, type ChannelApi } from '@/lib/updateChannel';

export function ChannelSwitch() {
  const colors = useColors();
  const styles = makeStyles(colors);
  const updates = loadUpdates();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!updatesUsable(updates)) {
    return (
      <Text style={styles.note} testID="channel-switch-unavailable">
        Updates from: not available in this build (development, Expo Go or the web).
      </Text>
    );
  }

  const channel = runningChannel(updates.channel);
  const preview = onPreview(updates.channel);
  const api: ChannelApi = {
    setChannel: (c) => updates.setUpdateRequestHeadersOverride(c ? { 'expo-channel-name': c } : null),
    check: () => updates.checkForUpdateAsync(),
    fetch: () => updates.fetchUpdateAsync(),
    reload: () => updates.reloadAsync(),
  };
  const go = async () => {
    setBusy(true);
    setMessage(preview ? 'Switching back to production…' : 'Checking preview…');
    const out = preview ? await switchToProduction(api) : await switchToPreview(api);
    setMessage(outcomeMessage(out));
    if (out.kind !== 'restarting') setBusy(false);
  };

  return (
    <View style={styles.box} testID="channel-switch">
      <Text style={styles.label}>Updates from</Text>
      <Text style={[styles.value, preview && styles.previewValue]} testID="channel-switch-current">
        {channel}
        {preview ? ' — only this phone' : ''}
      </Text>
      <SheetButton
        label={busy ? 'Working…' : preview ? 'Back to production' : `Use ${PREVIEW}`}
        onPress={() => void go()}
        disabled={busy}
        testID="channel-switch-button"
      />
      <Text style={styles.note}>
        {preview
          ? 'This phone runs updates published to preview. Back to production restarts the app on what everyone else has.'
          : 'Runs updates published to preview on this phone only, to test them before they are promoted. Restarts the app; does nothing if preview has no update.'}
      </Text>
      {message ? (
        <Text style={styles.message} accessibilityLiveRegion="polite" testID="channel-switch-message">
          {message}
        </Text>
      ) : null}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    box: { gap: 6, marginBottom: 12 },
    label: { fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.faint },
    value: { fontSize: 15, lineHeight: 21, color: colors.foreground, fontWeight: '600' },
    previewValue: { color: colors.warmInk },
    note: { fontSize: 13, lineHeight: 18, color: colors.mutedForeground },
    message: { fontSize: 14, lineHeight: 20, color: colors.foreground },
  });
}
