/**
 * components/settings/UpdateStatus.tsx — the owner's view of which code
 * this launch is running, inside the testing sheet. Everything comes from
 * expo-updates' own constants and `useUpdates()`; lib/updateStatus.ts
 * decides the wording, and README "Over-the-air updates" says how to read
 * it.
 *
 * expo-updates is required lazily, as FeedbackRow does: a module that
 * fails to load shows a line saying so instead of taking Settings down.
 * The hook lives in a child that renders only when the module is there,
 * so it is called on every render of that child or never.
 */

import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useColors, type Colors } from '@/hooks/useColors';
import { updateRows, type UpdateSnapshot } from '@/lib/updateStatus';

type Running = {
  updateId?: string;
  channel?: string;
  createdAt?: Date;
  isEmbeddedLaunch: boolean;
  isEmergencyLaunch: boolean;
  emergencyLaunchReason: string | null;
  runtimeVersion?: string;
};
type UpdatesModule = {
  isEnabled: boolean;
  useUpdates: () => {
    currentlyRunning: Running;
    isUpdatePending: boolean;
    lastCheckForUpdateTimeSinceRestart?: Date;
    checkError?: Error;
    downloadError?: Error;
  };
};

function loadUpdates(): UpdatesModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('expo-updates') as UpdatesModule;
    return typeof mod.useUpdates === 'function' ? mod : null;
  } catch {
    return null;
  }
}

const updates = loadUpdates();

export function UpdateStatus() {
  const colors = useColors();
  const styles = makeStyles(colors);
  if (!updates) {
    return <Text style={styles.value}>expo-updates could not be loaded in this build.</Text>;
  }
  return <Live mod={updates} styles={styles} />;
}

function Live({ mod, styles }: { mod: UpdatesModule; styles: ReturnType<typeof makeStyles> }) {
  const u = mod.useUpdates();
  const r = u.currentlyRunning;
  // `||`, not `??`: the web stub reports enabled with empty strings, and
  // an empty channel is no channel.
  const snapshot: UpdateSnapshot = {
    enabled: mod.isEnabled && Platform.OS !== 'web',
    updateId: r.updateId || null,
    channel: r.channel || null,
    runtimeVersion: r.runtimeVersion || null,
    isEmbeddedLaunch: r.isEmbeddedLaunch,
    isEmergencyLaunch: r.isEmergencyLaunch,
    emergencyLaunchReason: r.emergencyLaunchReason,
    createdAt: r.createdAt ?? null,
    lastCheck: u.lastCheckForUpdateTimeSinceRestart ?? null,
    isUpdatePending: u.isUpdatePending,
    checkError: u.checkError?.message ?? null,
    downloadError: u.downloadError?.message ?? null,
  };
  return (
    <View style={styles.box} testID="intro-testing-updates">
      {updateRows(snapshot, new Date()).map((row) => (
        <View key={row.label} style={styles.row}>
          <Text style={styles.label}>{row.label}</Text>
          <Text style={styles.value} selectable>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    box: { gap: 8, marginBottom: 12 },
    row: { gap: 2 },
    label: { fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.faint },
    value: { fontSize: 15, lineHeight: 21, color: colors.foreground },
  });
}
