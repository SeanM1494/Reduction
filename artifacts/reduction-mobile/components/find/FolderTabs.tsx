/**
 * components/find/FolderTabs.tsx — the Find screen's three tabs, drawn as
 * folder tabs on the pane they open.
 *
 * The shape is the Recipe Box's book tab (Book.tsx): rounded top corners,
 * joined to what is under it. The pane is the PAGE itself (Sep 29: the
 * cream pane read as a white slab across the tan app), so the chosen tab is
 * the page's colour with no line between it and the pane — the front
 * folder — and the others sit behind it: a shade DARKER than the page in
 * light (borderStrong, text in full foreground, 8.3:1), the raised card
 * brown of Settings in dark (card, muted text 5.7:1). Existing tokens only,
 * picked by the theme's own scheme. Unlike the book tab (22pt, 11pt
 * uppercase — a label on an object) these are controls, so they take the
 * app's control type (15pt heading font, as the Diagram / Step-by-Step
 * switch) and a 44pt height.
 *
 * FIT, measured in Space Grotesk SemiBold at 15pt: "My Recipes" 83pt,
 * "Add New" 63pt, "Browse" 53pt. With 12pt padding a side and 4pt between,
 * 279pt — inside the 288pt an iPhone SE (320pt, 16pt gutters) leaves. One
 * weight for all three states, so choosing a tab never changes its width
 * under the finger, and the labels' Dynamic Type growth is capped so a
 * large text setting cannot wrap them (the heading inside the pane says it
 * in full, and scales freely).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';

export type FindTab = 'mine' | 'add' | 'browse';

export const FIND_TABS: ReadonlyArray<{ id: FindTab; label: string }> = [
  { id: 'mine', label: 'My Recipes' },
  { id: 'add', label: 'Add New' },
  { id: 'browse', label: 'Browse' },
];

export function FolderTabs({ tab, onChange }: { tab: FindTab; onChange: (t: FindTab) => void }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  return (
    <View style={styles.row} accessibilityRole="tablist" testID="find-tabs">
      {FIND_TABS.map(({ id, label }) => {
        const active = id === tab;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            // aria-selected rather than accessibilityState: the same on iOS,
            // and the web export only carries the aria form.
            aria-selected={active}
            onPress={() => onChange(id)}
            style={({ pressed }) => [styles.tab, active ? styles.tabActive : styles.tabBack, pressed && !active && styles.tabPressed]}
            testID={`find-tab-${id}`}
          >
            <Text
              style={[styles.label, { color: active || colors.scheme !== 'dark' ? colors.foreground : colors.mutedForeground }]}
              numberOfLines={1}
              maxFontSizeMultiplier={1.15}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 4,
      paddingHorizontal: 16,
      paddingTop: 8,
      // The pane's top edge runs under every tab; the front one covers it.
      borderBottomWidth: 1,
      borderBottomColor: colors.borderStrong,
    },
    tab: {
      minHeight: 44,
      paddingHorizontal: 12,
      justifyContent: 'center',
      borderTopLeftRadius: 10,
      borderTopRightRadius: 10,
      borderWidth: 1,
      borderBottomWidth: 0,
    },
    // The front folder: the pane's colour, drawn 1pt over the pane's edge so
    // no line separates them.
    tabActive: { backgroundColor: colors.background, borderColor: colors.borderStrong, marginBottom: -1, paddingBottom: 1 },
    tabBack:
      colors.scheme === 'dark'
        ? { backgroundColor: colors.card, borderColor: colors.border }
        : { backgroundColor: colors.borderStrong, borderColor: colors.borderStrong },
    tabPressed: { borderColor: colors.borderStrong },
    label: { fontFamily: fonts.heading, fontSize: 15 },
  });
}
