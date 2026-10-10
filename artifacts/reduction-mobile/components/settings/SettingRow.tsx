/**
 * components/settings/SettingRow.tsx — the two pieces the Settings list is
 * made of: a thin row (name left, current value right) and the pop-up card
 * a row opens (a Window with a title and a Done button).
 *
 * A row says what it IS, not what it does: the value is the setting's
 * current state, so the list can be read without opening anything.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Window } from '@/components/Window';
import { SheetButton } from '@/components/Sheet';
import { useColors, type Colors } from '@/hooks/useColors';
import { cardShadow, fonts } from '@/constants/colors';

export function SettingRow({
  label,
  value,
  onPress,
  onLongPress,
  testID,
  hint,
}: {
  label: string;
  value?: string;
  onPress: () => void;
  onLongPress?: () => void;
  testID?: string;
  hint?: string;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      accessibilityHint={hint}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={600}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.name} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

/** A small mono heading over a group of rows. */
export function SettingGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle} accessibilityRole="header">
        {title}
      </Text>
      {children}
    </View>
  );
}

/** The pop-up a row opens. `onClosed` runs once it has finished closing —
 *  the place to push a screen or raise an Alert, never in the same breath. */
export function SettingWindow({
  open,
  title,
  onClose,
  onClosed,
  testID,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onClosed?: () => void;
  testID?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <Window open={open} onClose={onClose} onClosed={onClosed} testID={testID}>
      <View style={styles.winBody}>
        <Text style={styles.winTitle} accessibilityRole="header">
          {title}
        </Text>
        {children}
        <SheetButton label="Done" onPress={onClose} testID={testID ? `${testID}-done` : undefined} />
      </View>
    </Window>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: colors.radiusCard,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 16,
      ...cardShadow,
    },
    pressed: { borderColor: colors.borderStrong },
    name: { flex: 1, fontFamily: fonts.headingMedium, fontSize: 16, color: colors.foreground },
    value: { flexShrink: 1, fontSize: 14, color: colors.mutedForeground, textAlign: 'right' },
    group: { gap: 8 },
    groupTitle: { fontFamily: fonts.mono, fontSize: 11, letterSpacing: 0.44, color: colors.faint, textTransform: 'uppercase', marginLeft: 4, marginTop: 4 },
    winBody: { gap: 10 },
    winTitle: { fontFamily: fonts.headingMedium, fontSize: 20, color: colors.foreground },
  });
}
