/**
 * components/cooking/SwitchStrip.tsx — under Next step in Step-by-Step, the
 * other recipes being cooked, one tap to go to one (lib/cookingTray.ts
 * `switchChips` decides who and in what order). A chip whose timer has
 * finished turns terracotta and says so. Switching replaces the screen.
 *
 * It is a flex sibling under the scrolling card, not an overlay, so the
 * card shrinks to make room and Next step is never underneath it.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, type Colors } from '@/hooks/useColors';
import { fonts } from '@/constants/colors';
import { useCooking } from '@/lib/cooking-context';
import { useLibrary } from '@/lib/library-context';
import { cookProgress, switchChips } from '@/lib/cookingTray';
import { CookingTray, openCooking } from './CookingPill';

function fmt(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function SwitchStrip({ currentId }: { currentId: string }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const { cooking } = useCooking();
  const { update } = useLibrary();
  const [now, setNow] = useState(() => Date.now());
  const [trayOpen, setTrayOpen] = useState(false);
  const { chips, more } = switchChips(cooking, currentId, now);
  const ticking = chips.some((c) => c.state === 'running');

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  // A finished timer must flip a chip without a tick running.
  useEffect(() => {
    const next = chips
      .filter((c) => c.state === 'running')
      .map((c) => c.entry.timer!.endsAt - Date.now())
      .sort((a, b) => a - b)[0];
    if (next == null) return;
    const id = setTimeout(() => setNow(Date.now()), next + 50);
    return () => clearTimeout(id);
  }, [chips]);

  if (chips.length === 0) return null;

  return (
    <View style={[styles.strip, { paddingBottom: Math.max(insets.bottom, 8) }]} testID="switch-strip">
      {chips.map(({ entry, state }) => {
        const p = cookProgress(entry);
        const sub =
          state === 'done'
            ? 'Timer done'
            : state === 'running'
              ? fmt(entry.timer!.endsAt - now)
              : `Step ${Math.min(p.doneSteps + 1, p.total)} of ${p.total}`;
        return (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${entry.recipe.title}. ${sub}.`}
            onPress={() => openCooking(entry, update, 'replace')}
            style={[styles.chip, state === 'done' && styles.chipDone]}
            testID={`switch-chip-${entry.id}`}
          >
            <Text style={[styles.title, state === 'done' && styles.onDone]} numberOfLines={1}>
              {entry.recipe.title}
            </Text>
            <Text style={[styles.sub, state === 'done' && styles.onDone]} numberOfLines={1}>
              {`⇄ ${sub}`}
            </Text>
          </Pressable>
        );
      })}
      {more > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${more} more recipe${more === 1 ? '' : 's'} cooking. Open the list.`}
          onPress={() => setTrayOpen(true)}
          style={styles.more}
          testID="switch-more"
        >
          <Text style={styles.moreText}>{`+${more}`}</Text>
        </Pressable>
      ) : null}
      <CookingTray open={trayOpen} onClose={() => setTrayOpen(false)} how="replace" />
    </View>
  );
}

const makeStyles = (c: Colors) =>
  StyleSheet.create({
    strip: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 8, backgroundColor: c.background },
    chip: {
      flex: 1,
      minWidth: 0,
      minHeight: 52,
      borderRadius: 14,
      backgroundColor: c.foreground,
      paddingHorizontal: 12,
      paddingVertical: 7,
      justifyContent: 'center',
    },
    chipDone: { backgroundColor: c.destructive },
    title: { color: c.background, fontFamily: fonts.heading, fontSize: 14 },
    sub: { color: c.background, opacity: 0.85, fontFamily: fonts.heading, fontSize: 13, fontVariant: ['tabular-nums'] },
    onDone: { color: c.destructiveForeground, opacity: 1 },
    more: {
      minWidth: 52,
      minHeight: 52,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    moreText: { color: c.foreground, fontFamily: fonts.headingBold, fontSize: 15 },
  });
